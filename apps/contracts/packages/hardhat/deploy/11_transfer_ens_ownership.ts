import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const transfer_ens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const chainId = await hre.getChainId();
  if (chainId === "31337") {
    console.log(`⏭  Skipping ENS ownership transfer on chainId=${chainId} (ENS lives on Sepolia).`);
    return;
  }

  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const registrar = await hre.deployments.get("MarketSubnameRegistrar");
  const parentNode = ethers.namehash("kowalski.eth");

  const registry = new hre.ethers.Contract(
    ENS_REGISTRY,
    [
      "function owner(bytes32) view returns (address)",
      "function setOwner(bytes32,address)",
    ],
    signer,
  );

  const currentOwner = await registry.owner(parentNode);
  console.log("Current owner of kowalski.eth:", currentOwner);
  console.log("Registrar:", registrar.address);

  if (currentOwner.toLowerCase() === registrar.address.toLowerCase()) {
    console.log("✅ Registrar already owns kowalski.eth");
    return;
  }

  console.log("Transferring kowalski.eth ownership to registrar...");
  const tx = await registry.setOwner(parentNode, registrar.address, { gasLimit: 100_000 });
  await tx.wait();
  console.log("✅ Ownership transferred to registrar:", registrar.address);
};

export default transfer_ens;
transfer_ens.tags = ["ENSOwnership"];
transfer_ens.dependencies = ["ENSSetup"];
