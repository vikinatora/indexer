import { Contract } from "@ethersproject/contracts";
import { Wallet } from "@ethersproject/wallet";

export async function setupNFTs(
  nft: Contract,
  seller: Wallet,
  taker: Wallet,
  tokenId: number,
  operator: string
) {
  const tokenOwner = await nft.ownerOf(tokenId);
  console.log({
    tokenOwner,
    taker: taker.address,
    seller: seller.address,
  });

  // send back to seller
  if (tokenOwner == taker.address) {
    const backTx = await nft.connect(taker).transferFrom(taker.address, seller.address, tokenId);

    console.log("send token back");
    await backTx.wait();
  } else {
  }

  const isApproved = await nft.isApprovedForAll(seller.address, operator);

  // approve
  if (!isApproved) {
    const approveTx = await nft.setApprovalForAll(operator, true);
    console.log("approve token");
    await approveTx.wait();
  }
}
