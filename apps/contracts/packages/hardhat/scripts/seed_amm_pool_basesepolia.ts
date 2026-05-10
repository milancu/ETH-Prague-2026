import * as dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import password from "@inquirer/password";
import { Wallet, parseEther, formatEther, JsonRpcProvider } from "ethers";

const FUNDING = parseEther("500");
const FEE_BPS = 100;
const MINT_AMOUNT = parseEther("1000");

async function main() {
  if (hre.network.name !== "baseSepolia") {
    throw new Error(`Expected --network baseSepolia, got ${hre.network.name}`);
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encryptedKey) throw new Error("DEPLOYER_PRIVATE_KEY_ENCRYPTED not set in .env");

  const pass = await password({ message: "Enter password to decrypt deployer key:" });
  const decoded = await Wallet.fromEncryptedJson(encryptedKey, pass);

  const networkConfig = hre.network.config as { url?: string };
  if (!networkConfig.url) throw new Error("baseSepolia network missing rpc url");
  const provider = new JsonRpcProvider(networkConfig.url);
  const signer = decoded.connect(provider);
  const deployer = await signer.getAddress();

  const tabDep = await hre.deployments.get("TABcoin");
  const pmv2Dep = await hre.deployments.get("PredictionMarketV2");
  const ammDep = await hre.deployments.get("PredictionAMM");

  const TAB = await hre.ethers.getContractAt("TABcoin", tabDep.address, signer);
  const PMv2 = await hre.ethers.getContractAt("PredictionMarketV2", pmv2Dep.address, signer);
  const AMM = await hre.ethers.getContractAt("PredictionAMM", ammDep.address, signer);

  console.log(`Deployer: ${deployer}`);
  console.log(`TABcoin:  ${tabDep.address}`);
  console.log(`PMv2:     ${pmv2Dep.address}`);
  console.log(`AMM:      ${ammDep.address}`);

  const balance: bigint = await TAB.balanceOf(deployer);
  const bond: bigint = await PMv2.defaultBond();
  const needed = bond + FUNDING;
  console.log(
    `TAB balance: ${formatEther(balance)} | need: ${formatEther(needed)} (bond ${formatEther(bond)} + fund ${formatEther(FUNDING)})`,
  );

  if (balance < needed) {
    const toMint = needed - balance < MINT_AMOUNT ? MINT_AMOUNT : needed - balance;
    console.log(`Minting ${formatEther(toMint)} TAB to deployer (mock mint)…`);
    const tx = await TAB.mint(deployer, toMint, { gasLimit: 120_000 });
    await tx.wait();
  }

  const marketCount: bigint = await PMv2.marketCount();
  let marketId: bigint;

  if (marketCount === 0n) {
    if (bond > 0n) {
      console.log(`Approving ${formatEther(bond)} TAB bond to PMv2…`);
      const aTx = await TAB.approve(pmv2Dep.address, bond, { gasLimit: 100_000 });
      await aTx.wait();
    }

    console.log("Creating sample binary market…");
    const now = Math.floor(Date.now() / 1000);
    const cTx = await PMv2.createMarket(
      {
        name: "Vyhraje Sparta příští zápas?",
        description: "Sample market vytvořený seed_amm_pool_basesepolia.ts",
        category: "sport",
        outcomeType: 0,
        outcomeSlotCount: 2,
        outcomeLabels: ["Ano", "Ne"],
        oracle: deployer,
        expiresAt: now + 7 * 24 * 3600,
        resolutionTime: now + 7 * 24 * 3600 + 3600,
      },
      { gasLimit: 1_500_000 },
    );
    await cTx.wait();
    marketId = 0n;
    console.log("  ✓ market #0 created");
  } else {
    marketId = 0n;
    console.log(`Using existing market #${marketId} (marketCount=${marketCount})`);
  }

  try {
    const existing = await AMM.getPool(marketId);
    if (existing.exists) {
      console.log(`Pool for market #${marketId} already exists — skipping createPool.`);
      const reserves: bigint[] = await AMM.getReserves(marketId);
      console.log(`  reserves: ${reserves.map(r => formatEther(r)).join(" / ")}`);
      return;
    }
  } catch {
    /* Pool does not exist yet */
  }

  console.log(`Approving ${formatEther(FUNDING)} TAB to AMM…`);
  const apTx = await TAB.approve(ammDep.address, FUNDING, { gasLimit: 100_000 });
  await apTx.wait();

  console.log(`Creating AMM pool: ${formatEther(FUNDING)} TAB, fee ${FEE_BPS}bps…`);
  const cpTx = await AMM.createPool(marketId, FUNDING, FEE_BPS, { gasLimit: 2_500_000 });
  await cpTx.wait();

  const reserves: bigint[] = await AMM.getReserves(marketId);
  console.log(`  ✓ pool created — reserves: ${reserves.map(r => formatEther(r)).join(" / ")}`);
  console.log("AMM pool seed complete.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
