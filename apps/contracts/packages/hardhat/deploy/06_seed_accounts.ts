import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther, toBeHex } from "ethers";

// Authorizer is hard-coded in TABcoin.sol; only this address can mint TAB.
// The other two are user wallets that will be funded with ETH + TAB.
const AUTHORIZER = "0x48c5632dCC220Abf56000F93B1C4DEB501c64588";
const FUNDED_ACCOUNTS = [
  "0x92e30b6A54911a3385Bcd69F2dEc998A13ef692f",
  "0x933a8f32D8C2BA04643De7dBcaA38232c4a7847F",
  AUTHORIZER,
];

const ETH_AMOUNT = parseEther("100");
const TAB_AMOUNT = parseEther("100");

const seed_accounts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // Only run on local hardhat node — never seed live networks this way.
  const chainId = await hre.getChainId();
  if (chainId !== "31337") {
    console.log(`⏭  Skipping seed on chainId=${chainId} (only runs on local hardhat).`);
    return;
  }

  const tab = await hre.deployments.get("TABcoin");

  console.log("💰 Funding accounts with 100 ETH each...");
  for (const addr of FUNDED_ACCOUNTS) {
    await hre.network.provider.send("hardhat_setBalance", [addr, toBeHex(ETH_AMOUNT)]);
    console.log(`   ✓ ${addr} → 100 ETH`);
  }

  console.log("🪙 Minting 100 TAB to each account (impersonating authorizer)...");
  await hre.network.provider.send("hardhat_impersonateAccount", [AUTHORIZER]);
  const authorizerSigner = await hre.ethers.getSigner(AUTHORIZER);
  const tabContract = await hre.ethers.getContractAt("TABcoin", tab.address, authorizerSigner);

  // Explicit gasLimit avoids inheriting Base's 60M block gas which trips the L2 gas cap (~16.7M).
  for (const addr of FUNDED_ACCOUNTS) {
    const tx = await tabContract.mint(addr, TAB_AMOUNT, { gasLimit: 200_000 });
    await tx.wait();
    console.log(`   ✓ ${addr} → 100 TAB`);
  }

  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [AUTHORIZER]);
  console.log("✅ Seed complete.");
};

export default seed_accounts;
seed_accounts.tags = ["Seed"];
seed_accounts.dependencies = ["TABcoin"];
seed_accounts.runAtTheEnd = true;
