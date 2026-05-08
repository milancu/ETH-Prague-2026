import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_tab_clob: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("TabClob", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
};

export default deploy_tab_clob;
deploy_tab_clob.tags = ["TabClob"];
