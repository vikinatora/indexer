import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();
import { baseProvider } from "@/common/provider";
import { wait } from "../utils/test";
import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { Wallet } from "@ethersproject/wallet";
import { Element, Common } from "@reservoir0x/sdk";
import { config } from "@/config/index";
import { parseEther } from "@ethersproject/units";
import * as orders from "@/orderbook/orders";
import { logger } from "@/common/logger";

import { testNFTAddr, erc1155NFT, operatorKey, operator2Key } from "./__fixtures__/test-accounts";

import { setupNFTs, setupERC1155NFTs } from "../utils/nft";
import { getOrder } from "../utils/order";

const operatorProvider = new Wallet(operatorKey, baseProvider);
const operator2Provider = new Wallet(operator2Key, baseProvider);

jest.setTimeout(1000 * 1000);

describe("ElementTestnet", () => {
  const tokenId = 1;
  const chainId = config.chainId;
  const seller = operatorProvider;
  const buyer = operator2Provider;
  // test NFT contract
  const nftToken = new Contract(
    testNFTAddr,
    new Interface([
      "function safeMint(address to) public",
      "function balanceOf(address owner) public view returns(uint256)",
      "function ownerOf(uint256 _tokenId) external view returns (address)",
      "function setApprovalForAll(address _operator, bool _approved) external",
      "function transferFrom(address _from, address _to, uint256 _tokenId) external payable",
      "function isApprovedForAll(address _owner, address _operator) external view returns (bool)",
    ]),
    operatorProvider
  );

  const erc1155 = new Contract(
    erc1155NFT,
    new Interface([
      "function mint(uint256 tokenId) external",
      "function mintMany(uint256 tokenId, uint256 amount) external",
      "function balanceOf(address account, uint256 id) external view returns (uint256)",
      "function setApprovalForAll(address operator, bool approved) external",
      `function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
      ) external`,
      `function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
      ) external`,
      "function isApprovedForAll(address account, address operator) external view returns (bool)",
    ]),
    operatorProvider
  );

  const operator = Element.Addresses.Exchange[config.chainId];

  const indexInterval = 80 * 1000;

  // beforeEach(async () => {
  //   await setupNFTs(nftToken, seller, buyer, tokenId, operator);
  // });

  test("sellERC721", async () => {
    await setupNFTs(nftToken, seller, buyer, tokenId, operator);

    const exchange = new Element.Exchange(chainId);
    const builder = new Element.Builders.SingleToken(chainId);
    const price = parseEther("0.001");

    // Build Sell order
    const sellOrder = builder.build({
      direction: "sell",
      maker: seller.address,
      contract: nftToken.address,
      tokenId: tokenId,
      paymentToken: Element.Addresses.Eth[config.chainId],
      price,
      hashNonce: 0,
      expiry: Math.floor(Date.now() / 1000) + 10000,
    });

    await sellOrder.sign(seller);

    const orderInfo: orders.element.OrderInfo = {
      orderParams: sellOrder.params,
      metadata: {},
    };

    const orderId = sellOrder.hash();

    logger.info("ElementTestnet", `Save ${orderId} to database`);

    // Store order to database
    await orders.element.save([orderInfo]);

    await wait(10 * 1000);

    const ordeStatus = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(ordeStatus)}`);

    // Create matching buy order
    const buyOrder = sellOrder.buildMatching();

    // Fill order
    const fillTx = await exchange.fillOrder(buyer, sellOrder, buyOrder);

    logger.info("ElementTestnet", `Fill order=${orderId}, tx=${fillTx.hash}`);

    await fillTx.wait();

    logger.info("ElementTestnet", `Waiting... ${indexInterval}`);

    await wait(indexInterval);

    // Check order
    const orderAfter = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(orderAfter)}`);
    expect(orderAfter?.fillability_status).toEqual("filled");
  });

  test("buyERC721", async () => {
    await setupNFTs(nftToken, seller, buyer, tokenId, operator);

    const exchange = new Element.Exchange(chainId);
    const builder = new Element.Builders.SingleToken(chainId);
    const price = parseEther("0.001");

    const weth = new Common.Helpers.Weth(baseProvider, chainId);

    // Mint weth to buyer
    await weth.deposit(buyer, price);

    // Approve the exchange contract for the buyer
    const approveTx = await weth.approve(buyer, Element.Addresses.Exchange[chainId]);

    await approveTx.wait();

    await wait(20 * 1000);

    // Build Sell order
    const buyOrder = builder.build({
      direction: "buy",
      maker: buyer.address,
      contract: nftToken.address,
      tokenId: tokenId,
      paymentToken: Common.Addresses.Weth[chainId],
      price,
      hashNonce: 0,
      expiry: Math.floor(Date.now() / 1000) + 10000,
    });

    await buyOrder.sign(buyer);

    const orderInfo: orders.element.OrderInfo = {
      orderParams: buyOrder.params,
      metadata: {},
    };

    const orderId = buyOrder.hash();

    logger.info("ElementTestnet", `Save ${orderId} to database`);

    // Store order to database
    await orders.element.save([orderInfo]);

    await wait(10 * 1000);

    const ordeStatus = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(ordeStatus)}`);

    // Create matching buy order
    const sellOrder = buyOrder.buildMatching();

    // Fill order
    const fillTx = await exchange.fillOrder(seller, buyOrder, sellOrder);

    logger.info("ElementTestnet", `Fill order=${orderId}, tx=${fillTx.hash}`);

    await fillTx.wait();

    logger.info("ElementTestnet", `Waiting... ${indexInterval}`);

    await wait(indexInterval);

    // Check order
    const orderAfter = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(orderAfter)}`);
    expect(orderAfter?.fillability_status).toEqual("filled");
  });

  test("buyERC1155", async () => {
    await setupERC1155NFTs(erc1155, seller, buyer, tokenId, operator);
    const exchange = new Element.Exchange(chainId);
    const builder = new Element.Builders.SingleToken(chainId);
    const price = parseEther("0.001");

    // Build Sell order
    const sellOrder = builder.build({
      direction: "sell",
      maker: seller.address,
      contract: erc1155.address,
      tokenId: tokenId,
      amount: 1,
      paymentToken: Element.Addresses.Eth[config.chainId],
      price,
      hashNonce: 0,
      expiry: Math.floor(Date.now() / 1000) + 10000,
    });

    await sellOrder.sign(seller);

    const orderInfo: orders.element.OrderInfo = {
      orderParams: sellOrder.params,
      metadata: {},
    };

    const orderId = sellOrder.hash();

    logger.info("ElementTestnet", `Save ${orderId} to database`);

    // Store order to database
    const result = await orders.element.save([orderInfo]);
    console.log("result", result);
    // return;

    await wait(10 * 1000);

    const ordeStatus = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(ordeStatus)}`);

    // Create matching buy order
    const buyOrder = sellOrder.buildMatching();

    // Fill order
    const fillTx = await exchange.fillOrder(buyer, sellOrder, buyOrder);

    logger.info("ElementTestnet", `Fill order=${orderId}, tx=${fillTx.hash}`);

    await fillTx.wait();

    logger.info("ElementTestnet", `Waiting... ${indexInterval}`);

    await wait(indexInterval);

    // Check order
    const orderAfter = await getOrder(orderId);
    logger.info("ElementTestnet", `Order status ${JSON.stringify(orderAfter)}`);
    expect(orderAfter?.fillability_status).toEqual("filled");
  });

  //   test("balance-change", async () => {
  //     // const nftBalance1 = await idb.oneOrNone(
  //     //   `SELECT amount FROM "nft_balances" "o" WHERE "o"."owner" = $/maker/`,
  //     //   {
  //     //     id: orderId,
  //     //     maker: toBuffer(operatorProvider.address),
  //     //     contract: toBuffer(testNFTAddr),
  //     //     tokenId: tokenId,
  //     //   }
  //     // );

  //     // console.log("nftBalance1", nftBalance1);

  //     const tokenOwner = await nftToken.ownerOf(tokenId);
  //     const indexInterval = 40 * 1000;
  //     if (tokenOwner == operatorProvider.address) {
  //       const tx = await nftToken
  //         .connect(operatorProvider)
  //         .transferFrom(operatorProvider.address, operator2Provider.address, tokenId);
  //       await tx.wait();
  //       await wait(indexInterval);
  //     }

  //     // const nftBalance = await idb.oneOrNone(
  //     //   `SELECT amount FROM "nft_balances" "o" WHERE "o"."owner" = $/maker/`,
  //     //   {
  //     //     id: orderId,
  //     //     maker: toBuffer(operatorProvider.address),
  //     //     contract: toBuffer(testNFTAddr),
  //     //     tokenId: tokenId,
  //     //   }
  //     // );

  //     // console.log("nftBalance", nftBalance);

  //     const order = await idb.oneOrNone(
  //       `SELECT fillability_status FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     const backTx = await nftToken
  //       .connect(operator2Provider)
  //       .transferFrom(operator2Provider.address, operatorProvider.address, tokenId);
  //     await backTx.wait();

  //     await wait(indexInterval);

  //     const orderAfter = await idb.oneOrNone(
  //       `SELECT fillability_status FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     // const nftBalance2 = await idb.oneOrNone(
  //     //   `SELECT amount FROM "nft_balances" "o" WHERE "o"."owner" = $/maker/`,
  //     //   {
  //     //     id: orderId,
  //     //     maker: toBuffer(operatorProvider.address),
  //     //     contract: toBuffer(testNFTAddr),
  //     //     tokenId: tokenId,
  //     //   }
  //     // );

  //     expect(order?.fillability_status).toEqual("no-balance");
  //     expect(orderAfter?.fillability_status).toEqual("fillable");
  //   });

  //   test("approval-change", async () => {
  //     const indexInterval = 30 * 1000;

  //     const cancelTx = await nftToken
  //       .connect(operatorProvider)
  //       .setApprovalForAll(Zora.Addresses.Erc721TransferHelper[chainId], false);
  //     await cancelTx.wait();

  //     await wait(indexInterval);

  //     const order = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     const approvalTx = await nftToken
  //       .connect(operatorProvider)
  //       .setApprovalForAll(Zora.Addresses.Erc721TransferHelper[chainId], true);
  //     await approvalTx.wait();

  //     await wait(indexInterval);

  //     const orderAfter = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     expect(order?.approval_status).toEqual("no-approval");
  //     expect(orderAfter?.approval_status).toEqual("approved");
  //   });

  //   test("cancel-order", async () => {
  //     const seller = operatorProvider;
  //     const order = new Zora.Order(chainId, {
  //       tokenContract: testNFTAddr,
  //       tokenId,
  //       askPrice: "0",
  //       askCurrency: ethers.constants.AddressZero,
  //       sellerFundsRecipient: seller.address,
  //       findersFeeBps: 0,
  //     });

  //     const exchange = new Zora.Exchange(chainId);
  //     const cancelTxt = await exchange.cancelOrder(seller, order);
  //     await cancelTxt.wait();

  //     await wait(indexInterval);
  //     const dbOrder = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );
  //     // console.log("dbOrder", dbOrder);
  //     expect(dbOrder?.fillability_status).toEqual("cancelled");
  //   });

  //   test("update-order", async () => {
  //     const price = parseEther("0.002");
  //     const order = new Zora.Order(chainId, {
  //       tokenContract: testNFTAddr,
  //       tokenId,
  //       askPrice: price.toString(),
  //       askCurrency: ethers.constants.AddressZero,
  //       sellerFundsRecipient: operatorProvider.address,
  //       findersFeeBps: 0,
  //     });

  //     const exchange = new Zora.Exchange(chainId);
  //     const updateTx = await operatorProvider.sendTransaction({
  //       from: operatorProvider.address,
  //       to: exchange.contract.address,
  //       data: exchange.contract.interface.encodeFunctionData("setAskPrice", [
  //         order.params.tokenContract,
  //         order.params.tokenId,
  //         order.params.askPrice,
  //         order.params.askCurrency,
  //       ]),
  //     });

  //     await updateTx.wait();
  //     await wait(indexInterval);

  //     const dbOrder = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status, price FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     // console.log("dbOrder", dbOrder)
  //     expect(dbOrder?.price).toEqual(price.toString());
  //   });

  //   test("update-order-invalid-currency", async () => {
  //     const price = parseEther("0.002");
  //     const order = new Zora.Order(chainId, {
  //       tokenContract: testNFTAddr,
  //       tokenId,
  //       askPrice: price.toString(),
  //       // askCurrency: ethers.constants.AddressZero,
  //       askCurrency: "0x5ffbac75efc9547fbc822166fed19b05cd5890bb",
  //       sellerFundsRecipient: operatorProvider.address,
  //       findersFeeBps: 0,
  //     });

  //     const exchange = new Zora.Exchange(chainId);
  //     const updateTx = await operatorProvider.sendTransaction({
  //       from: operatorProvider.address,
  //       to: exchange.contract.address,
  //       data: exchange.contract.interface.encodeFunctionData("setAskPrice", [
  //         order.params.tokenContract,
  //         order.params.tokenId,
  //         order.params.askPrice,
  //         order.params.askCurrency,
  //       ]),
  //     });

  //     await updateTx.wait();
  //     await wait(indexInterval);

  //     const dbOrder = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status, price FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     // console.log("dbOrder", dbOrder)
  //     expect(dbOrder?.fillability_status).toEqual("cancelled");
  //   });

  //   test("fill-order", async () => {
  //     const price = parseEther("0.002");
  //     const order = new Zora.Order(chainId, {
  //       tokenContract: testNFTAddr,
  //       tokenId,
  //       askPrice: price.toString(),
  //       askCurrency: ethers.constants.AddressZero,
  //       sellerFundsRecipient: operatorProvider.address,
  //       findersFeeBps: 0,
  //     });

  //     const exchange = new Zora.Exchange(chainId);
  //     await exchange.fillOrder(operator2Provider, order);
  //     await wait(indexInterval);

  //     const dbOrder = await idb.oneOrNone(
  //       `SELECT fillability_status, approval_status, price FROM "orders" "o" WHERE "o"."id" = $/id/`,
  //       {
  //         id: orderId,
  //       }
  //     );

  //     // console.log("dbOrder", dbOrder)
  //     expect(dbOrder?.fillability_status).toEqual("filled");
  //   });
});
