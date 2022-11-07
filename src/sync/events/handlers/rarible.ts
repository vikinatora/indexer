import { defaultAbiCoder } from "@ethersproject/abi";
import { Log } from "@ethersproject/abstract-provider";
import * as Sdk from "@reservoir0x/sdk";

import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import * as es from "@/events-sync/storage";
import * as utils from "@/events-sync/utils";
import { getUSDAndNativePrices } from "@/utils/prices";

import * as fillUpdates from "@/jobs/fill-updates/queue";
import * as orderUpdatesById from "@/jobs/order-updates/by-id-queue";
import * as orderUpdatesByMaker from "@/jobs/order-updates/by-maker-queue";
import { config } from "@/config/index";
import { bn } from "@/common/utils";
import { Interface } from "ethers/lib/utils";
import { constants } from "ethers";
import { getERC20Transfer } from "./utils/erc20";

export const handleEvents = async (events: EnhancedEvent[]): Promise<OnChainData> => {
  const cancelEvents: es.cancels.Event[] = [];
  const fillEventsPartial: es.fills.Event[] = [];

  const fillInfos: fillUpdates.FillInfo[] = [];
  const orderInfos: orderUpdatesById.OrderInfo[] = [];
  const makerInfos: orderUpdatesByMaker.MakerInfo[] = [];

  // Keep track of all events within the currently processing transaction
  let currentTx: string | undefined;
  let currentTxLogs: Log[] = [];

  // Handle the events
  for (const { kind, baseEventParams, log } of events) {
    if (currentTx !== baseEventParams.txHash) {
      currentTx = baseEventParams.txHash;
      currentTxLogs = [];
    }
    currentTxLogs.push(log);

    const eventData = getEventData([kind])[0];
    switch (kind) {
      case "rarible-cancel": {
        const { args } = eventData.abi.parseLog(log);
        const orderId = args["hash"].toLowerCase();
        cancelEvents.push({
          orderKind: "rarible",
          orderId,
          baseEventParams,
        });
        orderInfos.push({
          context: `cancelled-${orderId}`,
          id: orderId,
          trigger: {
            kind: "cancel",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
            logIndex: baseEventParams.logIndex,
            batchIndex: baseEventParams.batchIndex,
            blockHash: baseEventParams.blockHash,
          },
        });
        break;
      }

      case "rarible-match": {
        const { args } = eventData.abi.parseLog(log);
        const leftHash = args["leftHash"].toLowerCase();
        const newLeftFill = args["newLeftFill"].toString();
        const newRightFill = args["newRightFill"].toString();

        const ERC20 = "0x8ae85d84";
        const ETH = "0xaaaebeba";
        const ERC721 = "0x73ad2146";
        const ERC721_LAZY = "0xd8f960c1";
        const ERC1155 = "0x973bb640";
        const ERC1155_LAZY = "1cdfaa40";

        const assetTypes = [ERC721, ERC721_LAZY, ERC1155, ERC1155_LAZY, ERC20, ETH];

        const orderKind = "rarible";
        let side: "sell" | "buy" = "sell";
        let taker = constants.AddressZero;
        let currencyAssetType = "";
        let nftAssetType = "";
        let nftData = "";
        let maker = "";
        let paymentCurrency = "";

        // Event data doesn't include full order information so we have to parse the calldata
        const tx = await utils.fetchTransaction(baseEventParams.txHash);

        // Rarible has 3 fill functions: directPurchase, directAcceptBid and matchOrders.
        // Try to parse calldata as directPurchase
        try {
          const iface = new Interface([
            "function directPurchase(tuple(address sellOrderMaker, uint256 sellOrderNftAmount, bytes4 nftAssetClass, bytes nftData, uint256 sellOrderPaymentAmount, address paymentToken, uint256 sellOrderSalt, uint sellOrderStart, uint sellOrderEnd, bytes4 sellOrderDataType, bytes sellOrderData, bytes sellOrderSignature, uint256 buyOrderPaymentAmount, uint256 buyOrderNftAmount, bytes buyOrderData))",
          ]);
          const result = iface.decodeFunctionData("directPurchase", tx.data);

          side = "sell";
          maker = result[0][0];
          nftAssetType = result[0][2];
          nftData = result[0][3];

          paymentCurrency = result[0][5];
          if (paymentCurrency === constants.AddressZero) {
            currencyAssetType = ETH;
          } else {
            currencyAssetType = ERC20;
          }
        } catch {
          // tx data doesn't match directPurchase
        }

        // Try to parse calldata as directAcceptBid
        try {
          const iface = new Interface([
            "function directAcceptBid(tuple(address bidMaker, uint256 bidNftAmount, bytes4 nftAssetClass, bytes nftData, uint256 bidPaymentAmount, address paymentToken, uint256 bidSalt, uint bidStart, uint bidEnd, bytes4 bidDataType, bytes bidData, bytes bidSignature, uint256 sellOrderPaymentAmount, uint256 sellOrderNftAmount, bytes sellOrderData) )",
          ]);
          const result = iface.decodeFunctionData("directAcceptBid", tx.data);

          side = "buy";
          maker = result[0][0];
          nftAssetType = result[0][2];
          nftData = result[0][3];

          paymentCurrency = result[0][5];
          if (paymentCurrency === constants.AddressZero) {
            currencyAssetType = ETH;
          } else {
            currencyAssetType = ERC20;
          }
        } catch {
          // tx data doesn't match directAcceptBid
        }

        // Try to parse calldata as matchOrders
        try {
          const iface = new Interface([
            "function matchOrders(tuple(address maker, tuple(tuple(bytes4 assetClass, bytes data) assetType, uint256 value) makeAsset, address taker, tuple(tuple(bytes4 assetClass, bytes data) assetType, uint256 value) takeAsset, uint256 salt, uint256 start, uint256 end, bytes4 dataType, bytes data) orderLeft, bytes signatureLeft, tuple(address maker, tuple(tuple(bytes4 assetClass, bytes data) assetType, uint256 value) makeAsset, address taker, tuple(tuple(bytes4 assetClass, bytes data) assetType, uint256 value) takeAsset, uint256 salt, uint256 start, uint256 end, bytes4 dataType, bytes data) orderRight, bytes signatureRight)",
          ]);
          const result = iface.decodeFunctionData("matchOrders", tx.data);
          const orderLeft = result.orderLeft;
          const leftAsset = orderLeft.makeAsset;
          const rightAsset = orderLeft.takeAsset;

          side = [ERC721, ERC721_LAZY, ERC1155, ERC1155_LAZY].includes(leftAsset.assetClass)
            ? "sell"
            : "buy";

          const nftAsset = side === "buy" ? rightAsset : leftAsset;
          const currencyAsset = side === "buy" ? leftAsset : rightAsset;

          nftData = nftAsset.assetType.data;
          nftAssetType = nftAsset.assetType.assetClass;
          currencyAssetType = currencyAsset.assetType.assetClass;

          if (currencyAssetType === ETH) {
            paymentCurrency = Sdk.Common.Addresses.Eth[config.chainId];
          } else if (currencyAssetType === ERC20) {
            const decodedCurrencyAsset = defaultAbiCoder.decode(
              ["(address token)"],
              currencyAsset.assetType.data
            );
            paymentCurrency = decodedCurrencyAsset[0][0];
          }
        } catch {
          // tx data doesn't match matchOrders
        }

        // Exclude orders with exotic asset types
        if (!assetTypes.includes(nftAssetType) || !assetTypes.includes(currencyAssetType)) {
          break;
        }

        // Handle: attribution
        const data = await utils.extractAttributionData(baseEventParams.txHash, orderKind);
        if (data.taker) {
          taker = data.taker;
        }
        // Handle: prices
        let currency: string;
        if (currencyAssetType === ETH) {
          currency = Sdk.Common.Addresses.Eth[config.chainId];
        } else if (currencyAssetType === ERC20) {
          currency = paymentCurrency;
        } else {
          break;
        }

        const decodedNftAsset = defaultAbiCoder.decode(["(address token, uint tokenId)"], nftData);
        const contract = decodedNftAsset[0][0].toLowerCase();
        const tokenId = decodedNftAsset[0][1].toString();
        const amount = newRightFill;
        let currencyPrice = newLeftFill;
        currencyPrice = bn(currencyPrice).div(amount).toString();

        const prices = await getUSDAndNativePrices(
          currency.toLowerCase(),
          currencyPrice,
          baseEventParams.timestamp
        );
        if (!prices.nativePrice) {
          // We must always have the native price
          break;
        }

        fillEventsPartial.push({
          orderKind,
          orderId: leftHash,
          orderSide: side,
          maker,
          taker,
          price: prices.nativePrice,
          currency,
          currencyPrice,
          usdPrice: prices.usdPrice,
          contract,
          tokenId,
          amount,
          orderSourceId: data.orderSource?.id,
          aggregatorSourceId: data.aggregatorSource?.id,
          fillSourceId: data.fillSource?.id,
          baseEventParams,
        });

        fillInfos.push({
          context: `${leftHash}-${baseEventParams.txHash}`,
          orderId: leftHash,
          orderSide: side,
          contract,
          tokenId,
          amount,
          price: prices.nativePrice,
          timestamp: baseEventParams.timestamp,
        });

        orderInfos.push({
          context: `filled-${leftHash}-${baseEventParams.txHash}`,
          id: leftHash,
          trigger: {
            kind: "sale",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
        });

        // If an ERC20 transfer occured in the same transaction as a sale
        // then we need resync the maker's ERC20 approval to the exchange
        const erc20 = getERC20Transfer(currentTxLogs);
        if (erc20) {
          makerInfos.push({
            context: `${baseEventParams.txHash}-buy-approval`,
            maker,
            trigger: {
              kind: "approval-change",
              txHash: baseEventParams.txHash,
              txTimestamp: baseEventParams.timestamp,
            },
            data: {
              kind: "buy-approval",
              contract: erc20,
              orderKind: "rarible",
            },
          });
        }

        break;
      }
    }
  }

  return {
    cancelEvents,
    fillEventsPartial,

    fillInfos,
    orderInfos,
    makerInfos,
  };
};
