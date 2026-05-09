import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const GATEWAY_URL = process.env.ENS_GATEWAY_URL || "http://localhost:8000/v1/ens-gateway/{sender}/{data}.json";
const ENS_GATEWAY_SIGNER = process.env.ENS_GATEWAY_SIGNER_ADDRESS || "";

const deploy_ens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const chainId = await hre.getChainId();
  if (chainId === "31337") {
    console.log(`⏭  Skipping ENS deploy on chainId=${chainId} (ENS lives on Sepolia).`);
    return;
  }

  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // On Sepolia: use real ENS registry + NameWrapper.
  // On localhost/hardhat: deploy mock ENS registry for testing.
  const network = hre.network.name;
  let registryAddr: string;
  let nameWrapperAddr: string;
  let useNameWrapper: boolean;

  if (network === "sepolia") {
    registryAddr = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
    nameWrapperAddr = "0x0635513f179D50A207757E05759CbD106d7dFcE8";
    useNameWrapper = false; // kowalski.eth is NOT wrapped on Sepolia
  } else {
    // Deploy a minimal mock ENS registry for local testing
    const mockRegistry = await deploy("MockENSRegistry", {
      from: deployer,
      contract: "MockENSRegistry",
      args: [],
      log: true,
      autoMine: true,
    });
    registryAddr = mockRegistry.address;
    nameWrapperAddr = ethers.ZeroAddress;
    useNameWrapper = false;
  }

  // Use deployer as gateway signer if not configured
  const signerAddr = ENS_GATEWAY_SIGNER || deployer;

  const resolverDeploy = await deploy("MarketResolver", {
    from: deployer,
    args: [deployer, signerAddr, [GATEWAY_URL]],
    log: true,
    autoMine: true,
  });

  // Compute parentNode for kowalski.eth
  const parentNode = ethers.namehash("kowalski.eth");

  await deploy("MarketSubnameRegistrar", {
    from: deployer,
    args: [
      registryAddr,
      nameWrapperAddr,
      resolverDeploy.address,
      parentNode,
      deployer,
      useNameWrapper,
    ],
    log: true,
    autoMine: true,
  });
};

export default deploy_ens;
deploy_ens.tags = ["ENS"];
