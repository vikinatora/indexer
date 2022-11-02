import { AddressZero } from "@ethersproject/constants";
import * as Sdk from "@reservoir0x/sdk";
import pLimit from "p-limit";

import { idb, pgp } from "@/common/db";
import { logger } from "@/common/logger";
import { bn, now, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import * as arweaveRelay from "@/jobs/arweave-relay";
import * as ordersUpdateById from "@/jobs/order-updates/by-id-queue";
import { DbOrder, OrderMetadata, generateSchemaHash } from "@/orderbook/orders/utils";
import { offChainCheck } from "@/orderbook/orders/rarible/check";
import * as commonHelpers from "@/orderbook/orders/common/helpers";
import * as tokenSet from "@/orderbook/token-sets";
import { Sources } from "@/models/sources";
import { IV2OrderData, IV3OrderBuyData } from "@reservoir0x/sdk/dist/rarible/types";

export type OrderInfo = {
  orderParams: Sdk.Rarible.Types.Order;
  metadata: OrderMetadata;
};

type SaveResult = {
  id: string;
  status: string;
  unfillable?: boolean;
};

export const save = async (
  orderInfos: OrderInfo[],
  relayToArweave?: boolean
): Promise<SaveResult[]> => {
  const results: SaveResult[] = [];
  const orderValues: DbOrder[] = [];

  const arweaveData: {
    order: Sdk.Rarible.Order;
    schemaHash?: string;
    source?: string;
  }[] = [];

  const handleOrder = async ({ orderParams, metadata }: OrderInfo) => {
    try {
      const order = new Sdk.Rarible.Order(config.chainId, orderParams);
      const id = order.hashOrderKey();
      const { side } = order.getInfo()!;
      // Check: order doesn't already exist
      const orderExists = await idb.oneOrNone(`SELECT 1 FROM "orders" "o" WHERE "o"."id" = $/id/`, {
        id,
      });
      if (orderExists) {
        return results.push({
          id,
          status: "already-exists",
        });
      }

      const currentTime = now();

      // Check: order has a valid listing time
      const listingTime = order.params.start;
      if (listingTime - 5 * 60 >= currentTime) {
        return results.push({
          id,
          status: "invalid-listing-time",
        });
      }

      // Check: order is not expired
      const expirationTime = order.params.end;
      if (currentTime >= expirationTime) {
        return results.push({
          id,
          status: "expired",
        });
      }

      const collection =
        side === "buy"
          ? order.params.take.assetType.contract!
          : order.params.make.assetType.contract!;

      const tokenId =
        side === "buy"
          ? order.params.take.assetType.tokenId!
          : order.params.make.assetType.tokenId!;
      const quantity = side === "buy" ? order.params.take.value : order.params.make.value;
      // Handle: currency
      let currency = "";
      if (side === "sell") {
        switch (order.params.take.assetType.assetClass) {
          case "ETH":
            currency = Sdk.Common.Addresses.Eth[config.chainId];
            break;
          case "ERC20":
            currency = order.params.take.assetType.contract!;
            break;
          default:
            break;
        }
      } else {
        // This will always be WETH for now
        currency = order.params.make.assetType.contract!;
      }

      // Check: order has Weth or Eth as payment token
      switch (side) {
        // Buy Order
        case "buy":
          if (currency !== Sdk.Common.Addresses.Weth[config.chainId]) {
            return results.push({
              id,
              status: "unsupported-payment-token",
            });
          }
          break;
        // Sell order
        case "sell":
          // We allow ETH and ERC20 orders so no need to validate here
          break;
        default:
          return results.push({
            id,
            status: "invalid-side",
          });
      }

      // Check: order is valid
      try {
        order.checkValidity();
      } catch {
        return results.push({
          id,
          status: "invalid",
        });
      }

      // Check: order has a valid signature
      try {
        order.checkSignature();
      } catch {
        return results.push({
          id,
          status: "invalid-signature",
        });
      }

      // Check: order fillability
      let fillabilityStatus = "fillable";
      let approvalStatus = "approved";
      try {
        await offChainCheck(order, { onChainApprovalRecheck: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        // Keep any orders that can potentially get valid in the future
        if (error.message === "no-balance-no-approval") {
          fillabilityStatus = "no-balance";
          approvalStatus = "no-approval";
        } else if (error.message === "no-approval") {
          approvalStatus = "no-approval";
        } else if (error.message === "no-balance") {
          fillabilityStatus = "no-balance";
        } else {
          return results.push({
            id,
            status: "not-fillable",
          });
        }
      }

      // Check and save: associated token set
      let tokenSetId: string | undefined;
      const schemaHash = metadata.schemaHash ?? generateSchemaHash(metadata.schema);

      switch (order.params.kind) {
        case "single-token": {
          [{ id: tokenSetId }] = await tokenSet.singleToken.save([
            {
              id: `token:${collection}:${tokenId}`,
              schemaHash,
              contract: collection,
              tokenId: tokenId,
            },
          ]);

          break;
        }
      }

      if (!tokenSetId) {
        return results.push({
          id,
          status: "invalid-token-set",
        });
      }

      // Handle: collection royalties
      const collectionRoyalties = await commonHelpers.getOpenSeaRoyalties(collection);

      const feeBreakdown = collectionRoyalties.map(({ bps, recipient }) => ({
        kind: "royalty",
        recipient,
        bps,
      }));

      // Handle: order origin fees
      let originFees: { kind: string; recipient: string; bps: number }[] = [];
      switch (order.params.data.dataType) {
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.V1:
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.API_V1:
          //TODO:
          break;

        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.API_V2:
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.V2:
          originFees = [
            ...originFees,
            ...((order.params.data as IV2OrderData).originFees || []).map((split) => ({
              kind: "royalty",
              recipient: split.account,
              bps: Number(split.value),
            })),
          ];
          break;

        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.V3_BUY:
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.V3_SELL:
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.API_V3_BUY:
        case Sdk.Rarible.Constants.ORDER_DATA_TYPES.API_V3_SELL:
          if ((order.params.data as IV3OrderBuyData).originFeeFirst) {
            const originFeeFirst = (order.params.data as IV3OrderBuyData).originFeeFirst;
            originFees = [
              ...originFees,
              {
                kind: "royalty",
                recipient: originFeeFirst.account,
                bps: Number(originFeeFirst.value),
              },
            ];
          }

          if ((order.params.data as IV3OrderBuyData).originFeeSecond) {
            const originFeeSecond = (order.params.data as IV3OrderBuyData).originFeeSecond;
            originFees = [
              ...originFees,
              {
                kind: "royalty",
                recipient: originFeeSecond.account,
                bps: Number(originFeeSecond.value),
              },
            ];
          }

          break;

        default:
          break;
      }

      const feeBps = feeBreakdown.map(({ bps }) => bps).reduce((a, b) => Number(a) + Number(b), 0);

      // Handle: price and value
      const price = side === "buy" ? order.params.make.value : order.params.take.value;

      // For sell orders, the value is the same as the price
      let value = price;
      if (side === "buy") {
        // For buy orders, we set the value as `price - fee` since it
        // is best for UX to show the user exactly what they're going
        // to receive on offer acceptance.
        const collectionFeeBps = collectionRoyalties
          .map(({ bps }) => bps)
          .reduce((a, b) => Number(a) + Number(b), 0);
        const originFeesBps = originFees
          .map(({ bps }) => bps)
          .reduce((a, b) => Number(a) + Number(b), 0);

        if (collectionFeeBps) {
          value = bn(value)
            .sub(bn(value).mul(bn(collectionFeeBps)).div(10000))
            .toString();
        }

        if (originFeesBps) {
          value = bn(value)
            .sub(bn(price).mul(bn(originFeesBps)).div(10000))
            .toString();
        }
      }

      // Handle: source
      const sources = await Sources.getInstance();
      let source = await sources.getOrInsert("rarible.com");
      if (metadata.source) {
        source = await sources.getOrInsert(metadata.source);
      }

      // Handle: native Reservoir orders
      const isReservoir = false;

      // Handle: conduit
      const conduit = Sdk.Rarible.Addresses.Exchange[config.chainId];

      const validFrom = `date_trunc('seconds', to_timestamp(${order.params.start}))`;
      const validTo = `date_trunc('seconds', to_timestamp(${order.params.end}))`;

      orderValues.push({
        id,
        kind: "rarible",
        side,
        fillability_status: fillabilityStatus,
        approval_status: approvalStatus,
        token_set_id: tokenSetId,
        token_set_schema_hash: toBuffer(schemaHash),
        maker: toBuffer(order.params.maker),
        taker: toBuffer(AddressZero),
        price,
        value,
        quantity_remaining: quantity ?? "1",
        currency: toBuffer(currency),
        currency_price: price,
        currency_value: value,
        needs_conversion: null,
        valid_between: `tstzrange(${validFrom}, ${validTo}, '[]')`,
        nonce: order.params.salt,
        source_id_int: source?.id,
        is_reservoir: isReservoir ? isReservoir : null,
        contract: toBuffer(collection),
        conduit: toBuffer(conduit),
        fee_bps: feeBps,
        fee_breakdown: feeBreakdown || null,
        dynamic: null,
        raw_data: order.params,
        expiration: validTo,
        missing_royalties: null,
      });

      const unfillable =
        fillabilityStatus !== "fillable" || approvalStatus !== "approved" ? true : undefined;

      results.push({
        id,
        status: "success",
        unfillable,
      });

      if (relayToArweave) {
        arweaveData.push({ order, schemaHash, source: source?.domain });
      }
    } catch (error) {
      logger.error(
        "orders-rarible-save",
        `Failed to handle order with params ${JSON.stringify(orderParams)}: ${error}`
      );
    }
  };

  // Process all orders concurrently
  const limit = pLimit(20);
  await Promise.all(orderInfos.map((orderInfo) => limit(() => handleOrder(orderInfo))));

  if (orderValues.length) {
    const columns = new pgp.helpers.ColumnSet(
      [
        "id",
        "kind",
        "side",
        "fillability_status",
        "approval_status",
        "token_set_id",
        "token_set_schema_hash",
        "maker",
        "taker",
        "price",
        "value",
        "currency",
        "currency_price",
        "currency_value",
        "needs_conversion",
        { name: "valid_between", mod: ":raw" },
        "nonce",
        "source_id_int",
        "is_reservoir",
        "contract",
        "conduit",
        "fee_bps",
        { name: "fee_breakdown", mod: ":json" },
        "dynamic",
        "raw_data",
        { name: "expiration", mod: ":raw" },
      ],
      {
        table: "orders",
      }
    );
    await idb.none(pgp.helpers.insert(orderValues, columns) + " ON CONFLICT DO NOTHING");

    await ordersUpdateById.addToQueue(
      results
        .filter((r) => r.status === "success" && !r.unfillable)
        .map(
          ({ id }) =>
            ({
              context: `new-order-${id}`,
              id,
              trigger: {
                kind: "new-order",
              },
            } as ordersUpdateById.OrderInfo)
        )
    );

    if (relayToArweave) {
      await arweaveRelay.addPendingOrdersRarible(arweaveData);
    }
  }

  return results;
};
