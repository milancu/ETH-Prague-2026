import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";

/**
 * Lokální seed: vytvoří sample binary market + AMM pool s 500 TAB likviditou.
 * Běží jen na chainId 31337 (hardhat node), aby se předešlo náhodnému
 * vytváření poolů na testnetu/mainnetu.
 *
 * Předpoklady:
 *   - 06_seed_accounts.ts už mintnul 1000 TAB deployerovi (hardhat[0]).
 *   - 09_deploy_prediction_amm.ts už deploynul PredictionAMM.
 */
const seed_amm_pool: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const chainId = await hre.getChainId();
  if (chainId !== "31337") {
    console.log(`⏭  Skipping AMM pool seed on chainId=${chainId} (only runs on local hardhat).`);
    return;
  }

  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const tab = await hre.deployments.get("TABcoin");
  const pmv2 = await hre.deployments.get("PredictionMarketV2");
  const amm = await hre.deployments.get("PredictionAMM");

  const TAB = await hre.ethers.getContractAt("TABcoin", tab.address, deployerSigner);
  const PMV2 = await hre.ethers.getContractAt("PredictionMarketV2", pmv2.address, deployerSigner);
  const AMM = await hre.ethers.getContractAt("PredictionAMM", amm.address, deployerSigner);

  // Pokud už nějaký market existuje, jen vyseedni pool pro market 0.
  const marketCount = await PMV2.marketCount();
  let marketId: bigint;

  if (marketCount === 0n) {
    console.log("📝 Creating sample binary market…");
    const now = Math.floor(Date.now() / 1000);
    const tx = await PMV2.createMarket(
      {
        name: "Vyhraje Sparta příští zápas?",
        description: "Sample market vygenerovaný 10_seed_amm_pool.ts",
        category: "sport",
        outcomeType: 0, // BINARY
        outcomeSlotCount: 2,
        outcomeLabels: ["Ano", "Ne"],
        oracle: deployer,
        expiresAt: now + 7 * 24 * 3600,
        resolutionTime: now + 7 * 24 * 3600 + 3600,
      },
      { gasLimit: 800_000 },
    );
    await tx.wait();
    marketId = 0n;
    console.log(`   ✓ market #0 created`);
  } else {
    marketId = 0n;
    console.log(`📝 Using existing market #0 (marketCount=${marketCount})`);
  }

  // Pokud pool už existuje, skipni.
  try {
    await AMM.getPool(marketId);
    console.log(`⏭  Pool for market #${marketId} already exists.`);
    return;
  } catch {
    /* PoolMissing — pokračuj */
  }

  const FUNDING = parseEther("500");
  const FEE_BPS = 100; // 1 %

  console.log(`🪙 Approving ${FUNDING / 10n ** 18n} TAB to AMM…`);
  const approveTx = await TAB.approve(amm.address, FUNDING, { gasLimit: 100_000 });
  await approveTx.wait();

  console.log(`🏊 Creating AMM pool: ${FUNDING / 10n ** 18n} TAB, fee ${FEE_BPS}bps…`);
  const createTx = await AMM.createPool(marketId, FUNDING, FEE_BPS, { gasLimit: 1_500_000 });
  await createTx.wait();

  const reserves = await AMM.getReserves(marketId);
  console.log(`   ✓ pool created — reserves[YES]=${reserves[0]}, reserves[NO]=${reserves[1]}`);
  console.log("✅ AMM pool seed complete.");
};

export default seed_amm_pool;
seed_amm_pool.tags = ["AmmPoolSeed"];
seed_amm_pool.dependencies = ["PredictionAMM", "Seed"];
seed_amm_pool.runAtTheEnd = true;
