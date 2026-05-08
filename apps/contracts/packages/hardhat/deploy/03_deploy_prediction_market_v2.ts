import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";

const DEFAULT_BOND = parseEther("50");
const CREATOR_CANCEL_WINDOW = 3600n;

const deploy_prediction_market: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const tab = await get("TABcoin");
  const ct = await get("ConditionalTokens");

  // Deployer always starts as curator/governance/treasury so post-deploy wiring
  // (setWrapperFactory etc.) works. Step 08 transfers roles to env addresses.
  const curator = deployer;
  const governance = deployer;
  const treasury = deployer;

  await deploy("PredictionMarketV2", {
    from: deployer,
    args: [tab.address, ct.address, curator, governance, treasury, DEFAULT_BOND, CREATOR_CANCEL_WINDOW],
    log: true,
    autoMine: true,
  });
};

export default deploy_prediction_market;
deploy_prediction_market.tags = ["PredictionMarketV2"];
deploy_prediction_market.dependencies = ["TABcoin", "ConditionalTokens"];
