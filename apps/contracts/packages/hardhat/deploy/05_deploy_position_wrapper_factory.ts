import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_position_wrapper_factory: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const wrapperImpl = await get("PositionWrapper");
  const ct = await get("ConditionalTokens");

  const factoryDeployment = await deploy("PositionWrapperFactory", {
    from: deployer,
    args: [wrapperImpl.address, ct.address],
    log: true,
    autoMine: true,
  });

  // Wire factory into PredictionMarketV2 so splitAndWrap can mint wrappers.
  const pmv2 = await hre.ethers.getContract<any>("PredictionMarketV2", deployer);
  const current: string = await pmv2.wrapperFactory();
  if (current.toLowerCase() !== factoryDeployment.address.toLowerCase()) {
    const tx = await pmv2.setWrapperFactory(factoryDeployment.address, { gasLimit: 100_000 });
    await tx.wait();
    console.log(`PredictionMarketV2.setWrapperFactory(${factoryDeployment.address})`);
  }
};

export default deploy_position_wrapper_factory;
deploy_position_wrapper_factory.tags = ["PositionWrapperFactory"];
deploy_position_wrapper_factory.dependencies = ["PositionWrapper", "ConditionalTokens", "PredictionMarketV2"];
