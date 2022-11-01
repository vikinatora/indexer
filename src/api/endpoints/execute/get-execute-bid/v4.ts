/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import * as Sdk from "@reservoir0x/sdk";
import { TxData } from "@reservoir0x/sdk/dist/utils";
import Joi from "joi";
import _ from "lodash";

import { logger } from "@/common/logger";
import { baseProvider } from "@/common/provider";
import { bn, regex } from "@/common/utils";
import { config } from "@/config/index";

// LooksRare
import * as looksRareBuyToken from "@/orderbook/orders/looks-rare/build/buy/token";
import * as looksRareBuyCollection from "@/orderbook/orders/looks-rare/build/buy/collection";

// Seaport
import * as seaportBuyAttribute from "@/orderbook/orders/seaport/build/buy/attribute";
import * as seaportBuyToken from "@/orderbook/orders/seaport/build/buy/token";
import * as seaportBuyCollection from "@/orderbook/orders/seaport/build/buy/collection";

// X2Y2
import * as x2y2BuyCollection from "@/orderbook/orders/x2y2/build/buy/collection";
import * as x2y2BuyToken from "@/orderbook/orders/x2y2/build/buy/token";

// ZeroExV4
import * as zeroExV4BuyAttribute from "@/orderbook/orders/zeroex-v4/build/buy/attribute";
import * as zeroExV4BuyToken from "@/orderbook/orders/zeroex-v4/build/buy/token";
import * as zeroExV4BuyCollection from "@/orderbook/orders/zeroex-v4/build/buy/collection";

// Universe
import * as universeBuyToken from "@/orderbook/orders/universe/build/buy/token";

// Forward
import * as forwardBuyAttribute from "@/orderbook/orders/forward/build/buy/attribute";
import * as forwardBuyToken from "@/orderbook/orders/forward/build/buy/token";
import * as forwardBuyCollection from "@/orderbook/orders/forward/build/buy/collection";

//Rarible
import * as raribleBuyToken from "@/orderbook/orders/rarible/build/buy/token";

const version = "v4";

export const getExecuteBidV4Options: RouteOptions = {
  description: "Create bid (offer)",
  notes: "Generate a bid and submit it to multiple marketplaces",
  timeout: { server: 60000 },
  tags: ["api", "Orderbook"],
  plugins: {
    "hapi-swagger": {
      order: 11,
    },
  },
  validate: {
    payload: Joi.object({
      maker: Joi.string()
        .lowercase()
        .pattern(regex.address)
        .description(
          "Address of wallet making the order. Example: `0xF296178d553C8Ec21A2fBD2c5dDa8CA9ac905A00`"
        )
        .required(),
      source: Joi.string()
        .lowercase()
        .pattern(regex.domain)
        .description(
          `Domain of your app that is creating the order, e.g. \`myapp.xyz\`. This is used for filtering, and to attribute the "order source" of sales in on-chain analytics, to help your app get discovered. Lean more <a href='https://docs.reservoir.tools/docs/calldata-attribution'>here</a>`
        ),
      params: Joi.array().items(
        Joi.object({
          token: Joi.string()
            .lowercase()
            .pattern(regex.token)
            .description(
              "Bid on a particular token. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63:123`"
            ),
          tokenSetId: Joi.string().lowercase().description("Bid on a particular token set."),
          collection: Joi.string()
            .lowercase()
            .description(
              "Bid on a particular collection with collection-id. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
            ),
          attributeKey: Joi.string().description(
            "Bid on a particular attribute key. Example: `Composition`"
          ),
          attributeValue: Joi.string().description(
            "Bid on a particular attribute value. Example: `Teddy (#33)`"
          ),
          quantity: Joi.number().description(
            "Quantity of tokens user is buying. Only compatible with ERC1155 tokens. Example: `5`"
          ),
          weiPrice: Joi.string()
            .pattern(regex.number)
            .description("Amount bidder is willing to offer in wei. Example: `1000000000000000000`")
            .required(),
          orderKind: Joi.string()
            .valid("zeroex-v4", "seaport", "looks-rare", "x2y2", "universe", "forward", "rarible")
            .default("seaport")
            .description("Exchange protocol used to create order. Example: `seaport`"),
          orderbook: Joi.string()
            .valid("reservoir", "opensea", "looks-rare", "x2y2", "universe")
            .default("reservoir")
            .description("Orderbook where order is placed. Example: `Reservoir`"),
          automatedRoyalties: Joi.boolean()
            .default(true)
            .description("If true, royalties will be automatically included."),
          fees: Joi.array()
            .items(Joi.string().pattern(regex.fee))
            .description(
              "List of fees (formatted as `feeRecipient:feeBps`) to be bundled within the order. Example: `0xF296178d553C8Ec21A2fBD2c5dDa8CA9ac905A00:100`"
            ),
          excludeFlaggedTokens: Joi.boolean()
            .default(false)
            .description("If true flagged tokens will be excluded"),
          listingTime: Joi.string()
            .pattern(regex.unixTimestamp)
            .description(
              "Unix timestamp (seconds) indicating when listing will be listed. Example: `1656080318`"
            ),
          expirationTime: Joi.string()
            .pattern(regex.unixTimestamp)
            .description(
              "Unix timestamp (seconds) indicating when listing will expire. Example: `1656080318`"
            ),
          salt: Joi.string()
            .pattern(regex.number)
            .description("Optional. Random string to make the order unique"),
          nonce: Joi.string().pattern(regex.number).description("Optional. Set a custom nonce"),
        })
          .or("token", "collection", "tokenSetId")
          .oxor("token", "collection", "tokenSetId")
          .with("attributeValue", "attributeKey")
          .with("attributeKey", "attributeValue")
          .with("attributeKey", "collection")
      ),
    }),
  },
  response: {
    schema: Joi.object({
      steps: Joi.array().items(
        Joi.object({
          kind: Joi.string().valid("request", "signature", "transaction").required(),
          action: Joi.string().required(),
          description: Joi.string().required(),
          items: Joi.array()
            .items(
              Joi.object({
                status: Joi.string().valid("complete", "incomplete").required(),
                data: Joi.object(),
                orderIndex: Joi.number(),
              })
            )
            .required(),
        })
      ),
      query: Joi.object(),
    }).label(`getExecuteBid${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-execute-bid-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const payload = request.payload as any;

    try {
      const maker = payload.maker;
      const source = payload.source;

      // Set up generic bid steps
      const steps: {
        action: string;
        description: string;
        kind: string;
        items: {
          status: string;
          data?: any;
          orderIndex?: number;
        }[];
      }[] = [
        {
          action: "Wrapping ETH",
          description: "We'll ask your approval for converting ETH to WETH. Gas fee required.",
          kind: "transaction",
          items: [],
        },
        {
          action: "Approve WETH contract",
          description:
            "We'll ask your approval for the exchange to access your token. This is a one-time only operation per exchange.",
          kind: "transaction",
          items: [],
        },
        {
          action: "Authorize offer",
          description: "A free off-chain signature to create the offer",
          kind: "signature",
          items: [],
        },
      ];

      for (let i = 0; i < payload.params.length; i++) {
        const params = payload.params[i];

        const token = params.token;
        const collection = params.collection;
        const tokenSetId = params.tokenSetId;
        const attributeKey = params.attributeKey;
        const attributeValue = params.attributeValue;

        if (!token) {
          // TODO: Re-enable collection/attribute bids on external orderbooks
          if (!["reservoir", "opensea"].includes(params.orderbook)) {
            throw Boom.badRequest("Only single-token bids are supported on external orderbooks");
          } else if (params.orderbook === "opensea" && attributeKey && attributeValue) {
            throw Boom.badRequest("Attribute bids are not supported on `opensea` orderbook");
          }
        }

        // Handle fees
        // TODO: Refactor the builders to get rid of the separate fee/feeRecipient arrays
        // TODO: Refactor the builders to get rid of the API params naming dependency
        params.fee = [];
        params.feeRecipient = [];
        for (const feeData of params.fees ?? []) {
          const [feeRecipient, fee] = feeData.split(":");
          params.fee.push(fee);
          params.feeRecipient.push(feeRecipient);
        }

        // TODO: Add support for more ERC20 tokens in the future after it's supported by the indexer
        // Check the maker's Weth/Eth balance
        let wrapEthTx: TxData | undefined;
        const weth = new Sdk.Common.Helpers.Weth(baseProvider, config.chainId);
        const wethBalance = await weth.getBalance(maker);
        if (bn(wethBalance).lt(params.weiPrice)) {
          const ethBalance = await baseProvider.getBalance(maker);
          if (bn(wethBalance).add(ethBalance).lt(params.weiPrice)) {
            throw Boom.badData("Maker does not have sufficient balance");
          } else {
            wrapEthTx = weth.depositTransaction(maker, bn(params.weiPrice).sub(wethBalance));
          }
        }

        switch (params.orderKind) {
          case "seaport": {
            if (!["reservoir", "opensea"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `reservoir` and `opensea` are supported as orderbooks");
            }

            let order: Sdk.Seaport.Order;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await seaportBuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else if (tokenSetId || (collection && attributeKey && attributeValue)) {
              order = await seaportBuyAttribute.build({
                ...params,
                maker,
                collection,
                attributes: [
                  {
                    key: attributeKey,
                    value: attributeValue,
                  },
                ],
              });
            } else if (collection) {
              order = await seaportBuyCollection.build({
                ...params,
                maker,
                collection,
              });
            } else {
              throw Boom.internal("Wrong metadata");
            }

            const exchange = new Sdk.Seaport.Exchange(config.chainId);
            const conduit = exchange.deriveConduit(order.params.conduitKey);

            // Check the maker's WETH approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(maker, conduit);
            if (bn(wethApproval).lt(order.getMatchingPrice())) {
              approvalTx = weth.approveTransaction(maker, conduit);
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "seaport",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    attribute:
                      collection && attributeKey && attributeValue
                        ? {
                            collection,
                            key: attributeKey,
                            value: attributeValue,
                          }
                        : undefined,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    isNonFlagged: params.excludeFlaggedTokens,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "zeroex-v4": {
            if (!["reservoir"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `reservoir` is supported as orderbook");
            }

            let order: Sdk.ZeroExV4.Order | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await zeroExV4BuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else if (tokenSetId || (collection && attributeKey && attributeValue)) {
              order = await zeroExV4BuyAttribute.build({
                ...params,
                maker,
                collection,
                attributes: [
                  {
                    key: attributeKey,
                    value: attributeValue,
                  },
                ],
              });
            } else if (collection) {
              order = await zeroExV4BuyCollection.build({
                ...params,
                maker,
                collection,
              });
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.ZeroExV4.Addresses.Exchange[config.chainId]
            );
            if (bn(wethApproval).lt(bn(order.params.erc20TokenAmount).add(order.getFeeAmount()))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.ZeroExV4.Addresses.Exchange[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "zeroex-v4",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    attribute:
                      collection && attributeKey && attributeValue
                        ? {
                            collection,
                            key: attributeKey,
                            value: attributeValue,
                          }
                        : undefined,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    isNonFlagged: params.excludeFlaggedTokens,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "looks-rare": {
            if (!["reservoir", "looks-rare"].includes(params.orderbook)) {
              throw Boom.badRequest(
                "Only `reservoir` and `looks-rare` are supported as orderbooks"
              );
            }
            if (params.fees?.length) {
              throw Boom.badRequest("LooksRare does not support custom fees");
            }
            if (params.excludeFlaggedTokens) {
              throw Boom.badRequest("LooksRare does not support token-list bids");
            }

            let order: Sdk.LooksRare.Order | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await looksRareBuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else if (collection && !attributeKey && !attributeValue) {
              order = await looksRareBuyCollection.build({
                ...params,
                maker,
                collection,
              });
            } else {
              throw Boom.badRequest("LooksRare only supports single-token or collection-wide bids");
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.LooksRare.Addresses.Exchange[config.chainId]
            );
            if (bn(wethApproval).lt(bn(order.params.price))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.LooksRare.Addresses.Exchange[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "looks-rare",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "x2y2": {
            if (!["x2y2"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `x2y2` is supported as orderbook");
            }
            if (params.fees?.length) {
              throw Boom.badRequest("X2Y2 does not support explicit fees");
            }
            if (params.excludeFlaggedTokens) {
              throw Boom.badRequest("X2Y2 does not support token-list bids");
            }

            let order: Sdk.X2Y2.Types.LocalOrder | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await x2y2BuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else if (collection && !attributeKey && !attributeValue) {
              order = await x2y2BuyCollection.build({
                ...params,
                maker,
                collection,
              });
            } else {
              throw Boom.badRequest("X2Y2 only supports single-token or collection-wide bids");
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            const upstreamOrder = Sdk.X2Y2.Order.fromLocalOrder(config.chainId, order);

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.X2Y2.Addresses.Exchange[config.chainId]
            );
            if (bn(wethApproval).lt(bn(upstreamOrder.params.price))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.X2Y2.Addresses.Exchange[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: new Sdk.X2Y2.Exchange(
                  config.chainId,
                  config.x2y2ApiKey
                ).getOrderSignatureData(order),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "x2y2",
                      data: {
                        ...order,
                      },
                    },
                    tokenSetId,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "universe": {
            if (!["universe"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `universe` is supported as orderbook");
            }

            let order: Sdk.Universe.Order | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await universeBuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
                // This should change after bids support more ERC20 tokens
                currency: Sdk.Common.Addresses.Weth[config.chainId],
              });
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.Universe.Addresses.Exchange[config.chainId]
            );
            if (bn(wethApproval).lt(bn(order.params.make.value))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.Universe.Addresses.Exchange[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "universe",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    attribute:
                      collection && attributeKey && attributeValue
                        ? {
                            collection,
                            key: attributeKey,
                            value: attributeValue,
                          }
                        : undefined,
                    collection:
                      collection && params.excludeFlaggedTokens && !attributeKey && !attributeValue
                        ? collection
                        : undefined,
                    isNonFlagged: params.excludeFlaggedTokens,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "forward": {
            if (!["reservoir"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `reservoir` is supported as orderbook");
            }

            let order: Sdk.Forward.Order | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await forwardBuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else if (tokenSetId || (collection && attributeKey && attributeValue)) {
              order = await forwardBuyAttribute.build({
                ...params,
                maker,
                collection,
                attributes: [
                  {
                    key: attributeKey,
                    value: attributeValue,
                  },
                ],
              });
            } else if (collection) {
              order = await forwardBuyCollection.build({
                ...params,
                maker,
                collection,
              });
            } else {
              throw Boom.internal("Wrong metadata");
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.Forward.Addresses.Exchange[config.chainId]
            );
            if (bn(wethApproval).lt(bn(order.params.unitPrice).mul(order.params.amount))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.Forward.Addresses.Exchange[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "forward",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    attribute:
                      collection && attributeKey && attributeValue
                        ? {
                            collection,
                            key: attributeKey,
                            value: attributeValue,
                          }
                        : undefined,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    isNonFlagged: params.excludeFlaggedTokens,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }

          case "rarible": {
            if (!["reservoir", "rarible"].includes(params.orderbook)) {
              throw Boom.badRequest("Only `reservoir` and `rarible` are supported as orderbooks");
            }
            if (params.fees?.length) {
              throw Boom.badRequest("Rarible does not support custom fees");
            }
            if (params.excludeFlaggedTokens) {
              throw Boom.badRequest("Rarible does not support token-list bids");
            }

            let order: Sdk.Rarible.Order | undefined;
            if (token) {
              const [contract, tokenId] = token.split(":");
              order = await raribleBuyToken.build({
                ...params,
                maker,
                contract,
                tokenId,
              });
            } else {
              throw Boom.badRequest("Rarible only supports single-token");
            }

            if (!order) {
              throw Boom.internal("Failed to generate order");
            }

            // Check the maker's approval
            let approvalTx: TxData | undefined;
            const wethApproval = await weth.getAllowance(
              maker,
              Sdk.Rarible.Addresses.ERC20TransferProxy[config.chainId]
            );
            if (bn(wethApproval).lt(bn(order.params.make.value))) {
              approvalTx = weth.approveTransaction(
                maker,
                Sdk.Rarible.Addresses.ERC20TransferProxy[config.chainId]
              );
            }

            steps[0].items.push({
              status: !wrapEthTx ? "complete" : "incomplete",
              data: wrapEthTx,
              orderIndex: i,
            });
            steps[1].items.push({
              status: !approvalTx ? "complete" : "incomplete",
              data: approvalTx,
              orderIndex: i,
            });
            steps[2].items.push({
              status: "incomplete",
              data: {
                sign: order.getSignatureData(),
                post: {
                  endpoint: "/order/v3",
                  method: "POST",
                  body: {
                    order: {
                      kind: "rarible",
                      data: {
                        ...order.params,
                      },
                    },
                    tokenSetId,
                    collection:
                      collection && !attributeKey && !attributeValue ? collection : undefined,
                    orderbook: params.orderbook,
                    source,
                  },
                },
              },
              orderIndex: i,
            });

            // Go on with the next bid
            continue;
          }
        }
      }

      // We should only have a single ETH wrapping transaction
      if (steps[0].items.length > 1) {
        let amount = bn(0);
        for (let i = 0; i < steps[0].items.length; i++) {
          const itemAmount = bn(steps[0].items[i].data?.value || 0);
          if (itemAmount.gt(amount)) {
            amount = itemAmount;
          }
        }

        if (amount.gt(0)) {
          const weth = new Sdk.Common.Helpers.Weth(baseProvider, config.chainId);
          const wethWrapTx = weth.depositTransaction(maker, amount);

          steps[0].items = [
            {
              status: "incomplete",
              data: wethWrapTx,
            },
          ];
        } else {
          steps[0].items = [];
        }
      }

      // De-duplicate step items
      for (const step of steps) {
        // Assume `JSON.stringify` is deterministic
        const uniqueItems = _.uniqBy(step.items, ({ data }) => JSON.stringify(data));
        if (step.items.length > uniqueItems.length) {
          step.items = uniqueItems.map((item) => ({
            status: item.status,
            data: item.data,
            orderIndex: item.orderIndex,
          }));
        }
      }

      return { steps };
    } catch (error) {
      logger.error(`get-execute-bid-${version}-handler`, `Handler failure: ${error}`);
      throw error;
    }
  },
};
