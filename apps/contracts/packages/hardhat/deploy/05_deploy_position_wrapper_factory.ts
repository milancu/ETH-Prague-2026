import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_position_wrapper_factory: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const wrapperImpl = await get("PositionWrapper");
  const ct = await get("ConditionalTokens");

  await deploy("PositionWrapperFactory", {
    from: deployer,
    args: [wrapperImpl.address, ct.address],
    log: true,
    autoMine: true,
  });
};

export default deploy_position_wrapper_factory;
deploy_position_wrapper_factory.tags = ["PositionWrapperFactory"];
deploy_position_wrapper_factory.dependencies = ["PositionWrapper", "ConditionalTokens"];
