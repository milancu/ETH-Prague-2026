import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const ENS_REGISTRY_SEPOLIA = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAME_WRAPPER_SEPOLIA = "0x0635513f179D50A207757E05759CbD106d7dFcE8";

const setup_ens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const signer = await hre.ethers.getSigner(deployer);

  const resolver = await hre.deployments.get("MarketResolver");
  const parentNode = ethers.namehash("kowalski.eth");

  // Re-deploy registrar with useNameWrapper=false (kowalski.eth is unwrapped)
  const registrarDeploy = await deploy("MarketSubnameRegistrar", {
    from: deployer,
    args: [
      ENS_REGISTRY_SEPOLIA,
      NAME_WRAPPER_SEPOLIA,
      resolver.address,
      parentNode,
      deployer,
      false, // useNameWrapper = false (name is unwrapped)
    ],
    log: true,
    autoMine: true,
  });
  const registrar = registrarDeploy;

  // ── Debug: check ownership ──────────────────────────────────
  const registry = new hre.ethers.Contract(
    ENS_REGISTRY_SEPOLIA,
    [
      "function owner(bytes32) view returns (address)",
      "function resolver(bytes32) view returns (address)",
      "function setResolver(bytes32,address)",
    ],
    signer,
  );

  const nameWrapper = new hre.ethers.Contract(
    NAME_WRAPPER_SEPOLIA,
    [
      "function setApprovalForAll(address,bool)",
      "function isApprovedForAll(address,address) view returns (bool)",
      "function ownerOf(uint256) view returns (address)",
    ],
    signer,
  );

  const registryOwner = await registry.owner(parentNode);
  console.log("Registry owner of kowalski.eth:", registryOwner);
  console.log("NameWrapper address:", NAME_WRAPPER_SEPOLIA);
  console.log("Deployer:", deployer);

  // Check if the name is wrapped (registry owner = NameWrapper)
  const isWrapped = registryOwner.toLowerCase() === NAME_WRAPPER_SEPOLIA.toLowerCase();
  console.log("Name is wrapped:", isWrapped);

  if (isWrapped) {
    // Check NameWrapper ownership
    const tokenId = BigInt(parentNode);
    try {
      const wrapperOwner = await nameWrapper.ownerOf(tokenId);
      console.log("NameWrapper owner:", wrapperOwner);
    } catch (e: any) {
      console.log("NameWrapper ownerOf failed:", e.message?.slice(0, 100));
    }
  }

  // ── 1. Approve registrar on NameWrapper ─────────────────────
  const alreadyApproved = await nameWrapper.isApprovedForAll(deployer, registrar.address);
  if (!alreadyApproved) {
    console.log("Approving registrar on NameWrapper...");
    const tx1 = await nameWrapper.setApprovalForAll(registrar.address, true, { gasLimit: 100_000 });
    await tx1.wait();
    console.log("✅ Registrar approved:", registrar.address);
  } else {
    console.log("✅ Registrar already approved");
  }

  // ── 2. Set resolver for kowalski.eth ────────────────────────
  const currentResolver = await registry.resolver(parentNode);
  console.log("Current resolver:", currentResolver);

  if (currentResolver.toLowerCase() === resolver.address.toLowerCase()) {
    console.log("✅ Resolver already set");
    return;
  }

  if (!isWrapped) {
    // Unwrapped name: deployer is registry owner, call registry.setResolver directly
    console.log("Setting resolver via registry.setResolver (unwrapped name)...");
    const tx2 = await registry.setResolver(parentNode, resolver.address, { gasLimit: 100_000 });
    await tx2.wait();
    console.log("✅ Resolver set:", resolver.address);
  } else {
    console.log("⚠️  Name is wrapped. Set resolver manually via https://app.ens.domains/kowalski.eth");
    console.log("   Resolver → Custom → paste:", resolver.address);
  }
};

export default setup_ens;
setup_ens.tags = ["ENSSetup"];
setup_ens.dependencies = ["ENS"];
