import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther, toBeHex } from "ethers";

// Authorizer is hard-coded in TABcoin.sol; only this address can mint TAB.
const AUTHORIZER = "0x48c5632dCC220Abf56000F93B1C4DEB501c64588";

// Accounts seeded with ETH + TAB on the local Hardhat node.
const FUNDED_ACCOUNTS: { address: string; tab: bigint }[] = [
  { address: "0x92e30b6A54911a3385Bcd69F2dEc998A13ef692f", tab: parseEther("100") },
  { address: "0x933a8f32D8C2BA04643De7dBcaA38232c4a7847F", tab: parseEther("100") },
  { address: "0x4C8603951Ec9A0c2e737F19595caEcF883ed45Ef", tab: parseEther("50") },
  { address: AUTHORIZER, tab: parseEther("100") },
];

const ETH_AMOUNT = parseEther("100");

const seed_accounts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // Only run on local hardhat node — never seed live networks this way.
  const chainId = await hre.getChainId();
  if (chainId !== "31337") {
    console.log(`⏭  Skipping seed on chainId=${chainId} (only runs on local hardhat).`);
    return;
  }

  const tab = await hre.deployments.get("TABcoin");

  console.log("💰 Funding accounts with 100 ETH each...");
  for (const { address } of FUNDED_ACCOUNTS) {
    await hre.network.provider.send("hardhat_setBalance", [address, toBeHex(ETH_AMOUNT)]);
    console.log(`   ✓ ${address} → 100 ETH`);
  }

  console.log("🪙 Minting TAB to each account (impersonating authorizer)...");
  await hre.network.provider.send("hardhat_impersonateAccount", [AUTHORIZER]);
  const authorizerSigner = await hre.ethers.getSigner(AUTHORIZER);
  const tabContract = await hre.ethers.getContractAt("TABcoin", tab.address, authorizerSigner);

  // Explicit gasLimit avoids inheriting Base's 60M block gas which trips the L2 gas cap (~16.7M).
  for (const { address, tab: tabAmount } of FUNDED_ACCOUNTS) {
    const tx = await tabContract.mint(address, tabAmount, { gasLimit: 200_000 });
    await tx.wait();
    console.log(`   ✓ ${address} → ${tabAmount / 10n ** 18n} TAB`);
  }

  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [AUTHORIZER]);
  console.log("✅ Seed complete.");
};

export default seed_accounts;
seed_accounts.tags = ["Seed"];
seed_accounts.dependencies = ["TABcoin"];
seed_accounts.runAtTheEnd = true;
