import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_prediction_amm: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const pmv2 = await get("PredictionMarketV2");

  await deploy("PredictionAMM", {
    from: deployer,
    args: [pmv2.address],
    log: true,
    autoMine: true,
  });
};

export default deploy_prediction_amm;
deploy_prediction_amm.tags = ["PredictionAMM"];
deploy_prediction_amm.dependencies = ["PredictionMarketV2", "PositionWrapperFactory", "TABcoin"];
