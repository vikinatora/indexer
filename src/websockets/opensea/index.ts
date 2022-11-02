import { Network, OpenSeaStreamClient } from "@opensea/stream-js";
import { WebSocket } from "ws";
import { config } from "@/config/index";
import { logger } from "@/common/logger";
import * as orderbookOrders from "@/jobs/orderbook/orders-queue";
import { PartialOrderComponents } from "@/orderbook/orders/seaport";
import * as orders from "@/orderbook/orders";

if (config.doWebsocketWork && config.openSeaApiKey) {
  const network = config.chainId === 5 ? Network.TESTNET : Network.MAINNET;
  logger.info("opensea-websocket", `Subscribing to opensea ${network} stream API`);

  const client = new OpenSeaStreamClient({
    token: config.openSeaApiKey,
    network,
    connectOptions: {
      transport: WebSocket,
    },
    onError: async (error) => {
      logger.error("opensea-websocket", `error=${error}`);
    },
  });

  client.onItemListed("*", async (event) => {
    logger.info("opensea-websocket", `onItemListed Event. event=${JSON.stringify(event)}`);

    const [, contract, tokenId] = event.payload.item.nft_id.split("/");

    const orderInfo: orderbookOrders.GenericOrderInfo = {
      kind: "seaport",
      info: {
        kind: "partial",
        orderParams: {
          kind: "single-token",
          side: "sell",
          hash: event.payload.order_hash,
          price: event.payload.base_price,
          paymentToken: event.payload.payment_token.address,
          amount: event.payload.quantity,
          startTime: new Date(event.payload.listing_date).getTime(),
          endTime: new Date(event.payload.expiration_date).getTime(),
          contract,
          tokenId,
          offerer: event.payload.maker.address,
        } as PartialOrderComponents,
      } as orders.seaport.OrderInfo,
      relayToArweave: false,
      validateBidValue: true,
    };

    await orderbookOrders.addToQueue([orderInfo]);
  });
}
