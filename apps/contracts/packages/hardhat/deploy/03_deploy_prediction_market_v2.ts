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

  // On local networks the deployer must own these roles, otherwise post-deploy
  // wiring (e.g. setWrapperFactory) reverts with NotGovernance. Live networks
  // honor the env vars so we can pin operator wallets.
  const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const curator = isLocal ? deployer : (process.env.CURATOR ?? deployer);
  const governance = isLocal ? deployer : (process.env.GOVERNANCE ?? deployer);
  const treasury = isLocal ? deployer : (process.env.TREASURY ?? deployer);

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
