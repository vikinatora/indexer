import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { parseEther } from "@ethersproject/units";
import * as Sdk from "@reservoir0x/sdk/src";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { ethers } from "hardhat";

import { ExecutionInfo } from "../helpers/router";
import { SuperRareListing, setupSuperRareListings } from "../helpers/superrare";
import {
  bn,
  getChainId,
  getRandomBoolean,
  getRandomFloat,
  getRandomInteger,
  reset,
  setupNFTs,
} from "../../../utils";

describe("[ReservoirV6_0_0] SuperRare listings", () => {
  const chainId = getChainId();

  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let david: SignerWithAddress;
  let emilio: SignerWithAddress;

  let erc721: Contract;
  let router: Contract;
  let superRareModule: Contract;

  beforeEach(async () => {
    [deployer, alice, bob, carol, david, emilio] = await ethers.getSigners();

    ({ erc721 } = await setupNFTs(deployer));

    router = await ethers
      .getContractFactory("ReservoirV6_0_0", deployer)
      .then((factory) => factory.deploy());
    superRareModule = await ethers
      .getContractFactory("SuperRareModule", deployer)
      .then((factory) => factory.deploy(router.address, router.address));
  });

  const getBalances = async (token: string) => {
    if (token === Sdk.Common.Addresses.Eth[chainId]) {
      return {
        alice: await ethers.provider.getBalance(alice.address),
        bob: await ethers.provider.getBalance(bob.address),
        carol: await ethers.provider.getBalance(carol.address),
        david: await ethers.provider.getBalance(david.address),
        emilio: await ethers.provider.getBalance(emilio.address),
        router: await ethers.provider.getBalance(router.address),
        superRareModule: await ethers.provider.getBalance(superRareModule.address),
      };
    } else {
      const contract = new Sdk.Common.Helpers.Erc20(ethers.provider, token);
      return {
        alice: await contract.getBalance(alice.address),
        bob: await contract.getBalance(bob.address),
        carol: await contract.getBalance(carol.address),
        david: await contract.getBalance(david.address),
        emilio: await contract.getBalance(emilio.address),
        router: await contract.getBalance(router.address),
        superRareModule: await contract.getBalance(superRareModule.address),
      };
    }
  };

  afterEach(reset);

  const testAcceptListings = async (
    // Whether to include fees on top
    chargeFees: boolean,
    // Whether to revert or not in case of any failures
    revertIfIncomplete: boolean,
    // Whether to cancel some orders in order to trigger partial filling
    partial: boolean,
    // Number of listings to fill
    listingsCount: number
  ) => {
    // Setup

    // Makers: Alice and Bob
    // Taker: Carol
    // Fee recipient: Emilio

    const listings: SuperRareListing[] = [];
    const feesOnTop: BigNumber[] = [];
    for (let i = 0; i < listingsCount; i++) {
      listings.push({
        seller: getRandomBoolean() ? alice : bob,
        nft: {
          contract: erc721,
          id: getRandomInteger(1, 10000),
        },
        price: parseEther(getRandomFloat(0.0001, 2).toFixed(6)),
        isCancelled: partial && getRandomBoolean(),
      });
      if (chargeFees) {
        feesOnTop.push(parseEther(getRandomFloat(0.0001, 0.1).toFixed(6)));
      }
    }
    await setupSuperRareListings(listings);
    // Prepare executions

    let totalPrice = bn(listings.map(({ price }) => price).reduce((a, b) => bn(a).add(b), bn(0)));
    // SuperRare fee
    totalPrice = totalPrice.add(totalPrice.mul(3).div(100));

    const executions: ExecutionInfo[] = [
      // 1. Fill listings
      listingsCount > 1
        ? {
            module: superRareModule.address,
            data: superRareModule.interface.encodeFunctionData("acceptETHListings", [
              listings.map((listing) => ({
                token: listing.nft.contract.address,
                tokenId: listing.nft.id,
                currency: Sdk.Common.Addresses.Eth[chainId],
                price: listing.price,
                priceWithFees: bn(listing.price).add(bn(listing.price).mul(3).div(100)),
              })),
              {
                fillTo: carol.address,
                refundTo: carol.address,
                revertIfIncomplete,
                amount: totalPrice,
              },
              [
                ...feesOnTop.map((amount) => ({
                  recipient: emilio.address,
                  amount,
                })),
              ],
            ]),
            value: totalPrice.add(
              // Anything on top should be refunded
              feesOnTop.reduce((a, b) => bn(a).add(b), bn(0)).add(parseEther("0.1"))
            ),
          }
        : {
            module: superRareModule.address,
            data: superRareModule.interface.encodeFunctionData("acceptETHListing", [
              {
                token: listings[0].nft.contract.address,
                tokenId: listings[0].nft.id,
                currency: Sdk.Common.Addresses.Eth[chainId],
                price: listings[0].price,
                priceWithFees: bn(listings[0].price).add(bn(listings[0].price).mul(3).div(100)),
              },
              {
                fillTo: carol.address,
                refundTo: carol.address,
                revertIfIncomplete,
                amount: totalPrice,
              },
              [
                ...feesOnTop.map((amount) => ({
                  recipient: emilio.address,
                  amount,
                })),
              ],
            ]),
            value: totalPrice.add(
              // Anything on top should be refunded
              feesOnTop.reduce((a, b) => bn(a).add(b), bn(0)).add(parseEther("0.1"))
            ),
          },
    ];

    // Checks

    // If the `revertIfIncomplete` option is enabled and we have any
    // orders that are not fillable, the whole transaction should be
    // reverted
    if (partial && revertIfIncomplete && listings.some(({ isCancelled }) => isCancelled)) {
      await expect(
        router.connect(carol).execute(executions, {
          value: executions.map(({ value }) => value).reduce((a, b) => bn(a).add(b), bn(0)),
        })
      ).to.be.revertedWith("reverted with custom error 'UnsuccessfulExecution()'");

      return;
    }
    // Fetch pre-state
    const balancesBefore = await getBalances(Sdk.Common.Addresses.Eth[chainId]);

    // Execute

    await router.connect(carol).execute(executions, {
      value: executions.map(({ value }) => value).reduce((a, b) => bn(a).add(b), bn(0)),
    });

    // Fetch post-state

    const balancesAfter = await getBalances(Sdk.Common.Addresses.Eth[chainId]);

    // Checks
    // Alice got the payment
    expect(balancesAfter.alice.sub(balancesBefore.alice)).to.eq(
      listings
        .filter(({ seller, isCancelled }) => !isCancelled && seller.address === alice.address)
        .map(({ price }) =>
          bn(price).sub(
            // Take into consideration the protocol fee
            bn(price).mul(15).div(100)
          )
        )
        .reduce((a, b) => bn(a).add(b), bn(0))
    );
    // Bob got the payment
    expect(balancesAfter.bob.sub(balancesBefore.bob)).to.eq(
      listings
        .filter(({ seller, isCancelled }) => !isCancelled && seller.address === bob.address)
        .map(({ price }) =>
          bn(price).sub(
            // Take into consideration the protocol fee
            bn(price).mul(15).div(100)
          )
        )
        .reduce((a, b) => bn(a).add(b), bn(0))
    );
    // Emilio got the fee payments
    if (chargeFees) {
      // Fees are charged per execution, and since we have a single execution
      // here, we will have a single fee payment at the end adjusted over the
      // amount that was actually paid (eg. prices of filled orders)
      const actualPaid = listings
        .filter(({ isCancelled }) => !isCancelled)
        .map(({ price }) => {
          return bn(price).add(bn(price).mul(3).div(100));
        })
        .reduce((a, b) => bn(a).add(b), bn(0));
      expect(balancesAfter.emilio.sub(balancesBefore.emilio)).to.eq(
        listings
          .map((_, i) => feesOnTop[i].mul(actualPaid).div(totalPrice))
          .reduce((a, b) => bn(a).add(b), bn(0))
      );
    }

    // Carol got the NFTs from all filled orders
    for (let i = 0; i < listings.length; i++) {
      if (!listings[i].isCancelled) {
        expect(await erc721.ownerOf(listings[i].nft.id)).to.eq(carol.address);
      } else {
        expect(await erc721.ownerOf(listings[i].nft.id)).to.eq(listings[i].seller.address);
      }
    }

    // Router is stateless
    expect(balancesAfter.router).to.eq(0);
    expect(balancesAfter.superRareModule).to.eq(0);
  };

  for (const multiple of [false, true]) {
    for (const partial of [false, true]) {
      for (const chargeFees of [false, true]) {
        for (const revertIfIncomplete of [false, true]) {
          it(
            "[eth]" +
              `${multiple ? "[multiple-orders]" : "[single-order]"}` +
              `${partial ? "[partial]" : "[full]"}` +
              `${chargeFees ? "[fees]" : "[no-fees]"}` +
              `${revertIfIncomplete ? "[reverts]" : "[skip-reverts]"}`,
            async () =>
              testAcceptListings(
                chargeFees,
                revertIfIncomplete,
                partial,
                multiple ? getRandomInteger(2, 6) : 1
              )
          );
        }
      }
    }
  }
});
