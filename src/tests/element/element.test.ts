import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();
import { baseProvider } from "@/common/provider";
import allTx from "./__fixtures__/tx";
// import { idb } from "@/common/db";
import { getEventsFromTx, wait } from "../utils/test";
import { handleEvents } from "@/events-sync/handlers/element";
// import { processOnChainData } from "@/events-sync/handlers/utils";
// import { keccak256 } from "@ethersproject/solidity";

import { TransactionResponse } from "@ethersproject/abstract-provider";
// import { Interface } from "@ethersproject/abi";
import { config } from "@/config/index";
import { Element } from "@reservoir0x/sdk";
import _ from "lodash";
// import { config } from "@/config/index";
// import { EventData } from "@/events-sync/data";

async function extractERC721SellOrder(
  chainId: any,
  exchange: Element.Exchange,
  transaction: TransactionResponse
) {
  const callArgs = exchange.contract.interface.decodeFunctionData("buyERC721", transaction.data);
  const order = callArgs.sellOrder;
  const signature = callArgs.signature;
  // const orderInfo = builder.build(order);
  const builder = new Element.Builders.SingleToken(chainId);
  const orderParams = {
    direction: "sell",
    maker: order.maker,
    contract: order.nft,
    tokenId: order.nftId.toString(),
    paymentToken: order.erc20Token,
    price: order.erc20TokenAmount.toString(),
    hashNonce: (await exchange.getHashNonce(baseProvider, order.maker)).toString(),
    expiry: order.expiry.toString(),
    nonce: order.nonce.toString(),
    fees: order.fees.map((_: any) => {
      return {
        recipient: _.recipient,
        amount: _.amount.toString(),
        feeData: _.feeData.toString(),
      };
    }),
    signatureType: signature.signatureType.toString(),
    v: signature.v.toString(),
    r: signature.r.toString(),
    s: signature.s.toString(),
  };

  // console.log("orderParams", orderParams, signature)
  const buyOrder = builder.build(orderParams as any);
  let isValidSignature = true;
  try {
    buyOrder.checkSignature();
  } catch (e) {
    isValidSignature = false;
  }

  return {
    isValidSignature,
    order: buyOrder,
    orderHash: buyOrder.hash(),
  };
}

describe("ElementExchange", () => {
  const chainId = config.chainId;
  test("buyERC721", async () => {
    const exchange = new Element.Exchange(chainId);
    const transaction = await baseProvider.getTransaction(allTx.buyERC721);
    // const callData = exchange.contract.interface.decodeFunctionData("buyERC721", transaction.data);
    const orderInfo = await extractERC721SellOrder(chainId, exchange, transaction);
    // console.log("callData", callData)
    // console.log("orderInfo", orderInfo)

    const tx = await baseProvider.getTransactionReceipt(allTx.buyERC721);
    const events = await getEventsFromTx(tx);
    const result = await handleEvents(events);

    const fillOrder = result.orderInfos?.filter((_) => _.id === orderInfo.orderHash);
    // console.log("result.orderInfos", result.orderInfos)
    expect(fillOrder).not.toBe(null);
    expect(result.orderInfos?.length).toEqual(1);
    expect(result.fillEvents?.length).toEqual(1);
    expect(result.fillInfos?.length).toEqual(1);
  });

  test("buyERC1155", async () => {
    const tx = await baseProvider.getTransactionReceipt(allTx.buyERC1155);
    const events = await getEventsFromTx(tx);
    const result = await handleEvents(events);
    // console.log("result", result)

    expect(result.orderInfos?.length).toEqual(1);
    expect(result.fillEventsPartial?.length).toEqual(1);
    expect(result.fillInfos?.length).toEqual(1);
    // if (createResult.orders?.length) console.log(createResult.orders[0])
    // console.log(cancelAskResult.cancelEventsOnChain)
    // await processOnChainData(createResult);
    // await wait(10 * 1000);
    // await processOnChainData(cancelAskResult);

    // await wait(10 * 1000);

    // const orderId = keccak256(
    //   ["string", "string", "uint256"],
    //   ["zora-v3", "0x2E6847e41c1193FE9528FA53c50e16C9fD082219", "3"]
    // );

    // const [order, cancelExist] = await Promise.all([
    //   idb.oneOrNone(`SELECT fillability_status FROM "orders" "o" WHERE "o"."id" = $/id/`, {
    //     id: orderId,
    //   }),
    //   idb.oneOrNone(`SELECT 1 FROM "cancel_events" "o" WHERE "o"."order_id" = $/id/`, {
    //     id: orderId,
    //   }),
    // ]);

    // expect(order?.fillability_status).toEqual("cancelled");
    // expect(!!cancelExist).toEqual(true);
  });

  test("cancelERC721", async () => {
    const tx = await baseProvider.getTransactionReceipt(allTx.cancelERC721);
    const events = await getEventsFromTx(tx);
    const result = await handleEvents(events);
    // console.log("result", result)

    expect(result.nonceCancelEvents?.length).toEqual(1);
    // expect(result.fillEventsPartial?.length).toEqual(1);
    // expect(result.fillInfos?.length).toEqual(1);
    // if (createResult.orders?.length) console.log(createResult.orders[0])
    // console.log(cancelAskResult.cancelEventsOnChain)
    // await processOnChainData(createResult);
    // await wait(10 * 1000);
    // await processOnChainData(cancelAskResult);

    // await wait(10 * 1000);

    // const orderId = keccak256(
    //   ["string", "string", "uint256"],
    //   ["zora-v3", "0x2E6847e41c1193FE9528FA53c50e16C9fD082219", "3"]
    // );

    // const [order, cancelExist] = await Promise.all([
    //   idb.oneOrNone(`SELECT fillability_status FROM "orders" "o" WHERE "o"."id" = $/id/`, {
    //     id: orderId,
    //   }),
    //   idb.oneOrNone(`SELECT 1 FROM "cancel_events" "o" WHERE "o"."order_id" = $/id/`, {
    //     id: orderId,
    //   }),
    // ]);

    // expect(order?.fillability_status).toEqual("cancelled");
    // expect(!!cancelExist).toEqual(true);
  });

  test("cancelERC1155Order", async () => {
    const tx = await baseProvider.getTransactionReceipt(allTx.cancelERC1155Order);
    const events = await getEventsFromTx(tx);
    const result = await handleEvents(events);
    // console.log("result", result)

    expect(result.nonceCancelEvents?.length).toEqual(1);
    // expect(result.fillEventsPartial?.length).toEqual(1);
    // expect(result.fillInfos?.length).toEqual(1);
    // if (createResult.orders?.length) console.log(createResult.orders[0])
    // console.log(cancelAskResult.cancelEventsOnChain)
    // await processOnChainData(createResult);
    // await wait(10 * 1000);
    // await processOnChainData(cancelAskResult);

    // await wait(10 * 1000);

    // const orderId = keccak256(
    //   ["string", "string", "uint256"],
    //   ["zora-v3", "0x2E6847e41c1193FE9528FA53c50e16C9fD082219", "3"]
    // );

    // const [order, cancelExist] = await Promise.all([
    //   idb.oneOrNone(`SELECT fillability_status FROM "orders" "o" WHERE "o"."id" = $/id/`, {
    //     id: orderId,
    //   }),
    //   idb.oneOrNone(`SELECT 1 FROM "cancel_events" "o" WHERE "o"."order_id" = $/id/`, {
    //     id: orderId,
    //   }),
    // ]);

    // expect(order?.fillability_status).toEqual("cancelled");
    // expect(!!cancelExist).toEqual(true);
  });

  // test("order-update", async () => {
  //   const setAskCreateTx = await baseProvider.getTransactionReceipt(allTx.setAskCreateTx);
  //   const setAskTx = await baseProvider.getTransactionReceipt(allTx.setAskTx);
  //   const eventsCreate = await getEventsFromTx(setAskCreateTx);
  //   const eventsSet = await getEventsFromTx(setAskTx);
  //   const result1 = await handleEvents(eventsCreate);
  //   const result2 = await handleEvents(eventsSet);
  //   await processOnChainData(result1);
  //   await wait(10 * 1000);
  //   await processOnChainData(result2);
  //   await wait(10 * 1000);
  //   const orderId = keccak256(
  //     ["string", "string", "uint256"],
  //     ["zora-v3", "0xabEFBc9fD2F806065b4f3C237d4b59D9A97Bcac7", "10042"]
  //   );
  //   const order = await idb.oneOrNone(`SELECT price FROM "orders" "o" WHERE "o"."id" = $/id/`, {
  //     id: orderId,
  //   });
  //   // after update
  //   expect(order?.price).toEqual("990000000000000000");
  // });
});
