import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_tab_clob: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const tab = await get("TABcoin");
  const factory = await get("PositionWrapperFactory");
  const pmv2 = await get("PredictionMarketV2");

  await deploy("TabClob", {
    from: deployer,
    args: [tab.address, factory.address, pmv2.address],
    log: true,
    autoMine: true,
  });
};

export default deploy_tab_clob;
deploy_tab_clob.tags = ["TabClob"];
deploy_tab_clob.dependencies = ["TABcoin", "PositionWrapperFactory", "PredictionMarketV2"];
