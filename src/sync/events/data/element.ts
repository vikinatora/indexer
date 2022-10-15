import { Interface } from "@ethersproject/abi";
import { Element } from "@reservoir0x/sdk";

import { config } from "@/config/index";
import { EventData } from "@/events-sync/data";

export const erc721OrderCancelled: EventData = {
  kind: "element-erc721-order-cancelled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0xa015ad2dc32f266993958a0fd9884c746b971b254206f3478bc43e2f125c7b9e",
  numTopics: 1,
  abi: new Interface([
    `event ERC721OrderCancelled(
      address maker,
      uint256 nonce
    )`,
  ]),
};

export const hashNonceIncremented: EventData = {
  kind: "element-hash-nonce-incremented",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0x4cf3e8a83c6bf8a510613208458629675b4ae99b8029e3ab6cb6a86e5f01fd31",
  numTopics: 1,
  abi: new Interface([
    `event HashNonceIncremented(
      address maker,
      uint256 nonce
    )`,
  ]),
};

export const erc1155OrderCancelled: EventData = {
  kind: "element-erc1155-order-cancelled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0x4d5ea7da64f50a4a329921b8d2cab52dff4ebcc58b61d10ff839e28e91445684",
  numTopics: 1,
  abi: new Interface([
    `event ERC1155OrderCancelled(
      address maker,
      uint256 nonce
    )`,
  ]),
};

export const erc721SellOrderFilled: EventData = {
  kind: "element-erc721-sell-order-filled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0x8a0f8e04e7a35efabdc150b7d106308198a4f965a5d11badf768c5b8b273ac94",
  numTopics: 1,
  abi: new Interface([
    `event ERC721SellOrderFilled(
      address maker,
      address taker,
      address erc20Token,
      uint256 erc20TokenAmount,
      address erc721Token,
      uint256 erc721TokenId,
      bytes32 orderHash
    )`,
  ]),
};

export const erc721BuyOrderFilled: EventData = {
  kind: "element-erc721-buy-order-filled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0xa24193d56ccdf64ce1df60c80ca683da965a1da3363efa67c14abf62b2d7d493",
  numTopics: 1,
  abi: new Interface([
    `event ERC721BuyOrderFilled(
      address maker,
      address taker,
      address erc20Token,
      uint256 erc20TokenAmount,
      address erc721Token,
      uint256 erc721TokenId,
      bytes32 orderHash
    )`,
  ]),
};

export const erc1155SellOrderFilled: EventData = {
  kind: "element-erc1155-sell-order-filled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0x3ae452568bed7ccafe4345f10048675bae78660c7ea37eb5112b572648d4f116",
  numTopics: 1,
  abi: new Interface([
    `event ERC1155SellOrderFilled(
      address maker,
      address taker,
      address erc20Token,
      uint256 erc20FillAmount,
      address erc1155Token,
      uint256 erc1155TokenId,
      uint128 erc1155FillAmount,
      bytes32 orderHash
    )`,
  ]),
};

export const erc1155BuyOrderFilled: EventData = {
  kind: "element-erc1155-buy-order-filled",
  addresses: { [Element.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: "0x020486beb4ea38db8dc504078b03c4f758de372097584b434a8b8f53583eecac",
  numTopics: 1,
  abi: new Interface([
    `event ERC1155BuyOrderFilled(
      address maker,
      address taker,
      address erc20Token,
      uint256 erc20FillAmount,
      address erc1155Token,
      uint256 erc1155TokenId,
      uint128 erc1155FillAmount,
      bytes32 orderHash
    )`,
  ]),
};
