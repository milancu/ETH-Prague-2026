import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deploy_conditional_tokens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("ConditionalTokens", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
};

export default deploy_conditional_tokens;
deploy_conditional_tokens.tags = ["ConditionalTokens"];
