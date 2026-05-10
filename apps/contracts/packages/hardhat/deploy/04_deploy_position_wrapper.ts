import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Implementation contract for EIP-1167 clones. Never call initialize on this address —
// the factory will clone it and initialize each clone separately.
const deploy_position_wrapper: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("PositionWrapper", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
};

export default deploy_position_wrapper;
deploy_position_wrapper.tags = ["PositionWrapper"];
