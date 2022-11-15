import {
  BaseStreamMessage,
  CollectionOfferEventPayload,
  EventType,
  ItemReceivedBidEventPayload,
  Network,
  OpenSeaStreamClient,
  TraitOfferEventPayload,
} from "@opensea/stream-js";
import { WebSocket } from "ws";
import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { ItemListedEventPayload } from "@opensea/stream-js/dist/types";
import { handleEvent as handleItemListedEvent } from "@/websockets/opensea/handlers/item_listed";
import { handleEvent as handleItemReceivedBidEvent } from "@/websockets/opensea/handlers/item_received_bid";
import { handleEvent as handleCollectionOfferEvent } from "@/websockets/opensea/handlers/collection_offer";
import { handleEvent as handleTraitOfferEvent } from "@/websockets/opensea/handlers/trait_offer";

import { PartialOrderComponents } from "@/orderbook/orders/seaport";
import * as orderbookOrders from "@/jobs/orderbook/orders-queue";
import * as orders from "@/orderbook/orders";
import { idb, pgp } from "@/common/db";

if (config.doWebsocketWork && config.openSeaApiKey) {
  const network = config.chainId === 5 ? Network.TESTNET : Network.MAINNET;

  const client = new OpenSeaStreamClient({
    token: config.openSeaApiKey,
    network,
    connectOptions: {
      transport: WebSocket,
    },
    onError: async (error) => {
      logger.error("opensea-websocket", `network=${network}, error=${JSON.stringify(error)}`);
    },
  });

  client.connect();

  logger.info("opensea-websocket", `Connected to opensea ${network} stream API`);

  client.onEvents(
    "*",
    [
      EventType.ITEM_LISTED,
      EventType.ITEM_RECEIVED_BID,
      EventType.COLLECTION_OFFER,
      // EventType.TRAIT_OFFER
    ],
    async (event) => {
      await saveEvent(event);

      const orderParams = handleEvent(event.event_type as EventType, event.payload);

      if (orderParams) {
        const orderInfo: orderbookOrders.GenericOrderInfo = {
          kind: "seaport",
          info: {
            kind: "partial",
            orderParams,
          } as orders.seaport.OrderInfo,
          relayToArweave: false,
          validateBidValue: true,
        };

        await orderbookOrders.addToQueue([orderInfo]);
      }
    }
  );
}

const saveEvent = async (event: BaseStreamMessage<unknown>) => {
  logger.info(
    "opensea-websocket",
    `saveEvent. event_type=${event.event_type}, event=${JSON.stringify(event)}`
  );

  try {
    const columns = new pgp.helpers.ColumnSet(
      ["event_type", "event_timestamp", "order_hash", "maker", "data"],
      { table: "opensea_websocket_events" }
    );

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const query = pgp.helpers.insert(
      {
        event_type: event.event_type,
        event_timestamp: (event.payload as any).event_timestamp,
        order_hash: (event.payload as any).order_hash,
        maker: (event.payload as any).maker?.address,
        data: event,
      },
      columns
    );

    logger.info(
      "opensea-websocket",
      `saveEvent query. query=${query}, event_type=${event.event_type}, event=${JSON.stringify(
        event
      )}`
    );

    await idb.none(query);
  } catch (error) {
    logger.error(
      "opensea-websocket",
      `saveEvent error. event=${JSON.stringify(event)}, error=${error}`
    );
  }
};

export const handleEvent = (type: EventType, payload: unknown): PartialOrderComponents | null => {
  switch (type) {
    case EventType.ITEM_LISTED:
      return handleItemListedEvent(payload as ItemListedEventPayload);
    case EventType.ITEM_RECEIVED_BID:
      return handleItemReceivedBidEvent(payload as ItemReceivedBidEventPayload);
    case EventType.COLLECTION_OFFER:
      return handleCollectionOfferEvent(payload as CollectionOfferEventPayload);
    case EventType.TRAIT_OFFER:
      return handleTraitOfferEvent(payload as TraitOfferEventPayload);
    default:
      return null;
  }
};
