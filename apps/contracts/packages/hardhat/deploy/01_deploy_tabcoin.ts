import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_tabcoin: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("TABcoin", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
};

export default deploy_tabcoin;
deploy_tabcoin.tags = ["TABcoin"];
