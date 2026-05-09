import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const test_ens: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const registrarDeploy = await hre.deployments.get("MarketSubnameRegistrar");
  const resolverDeploy = await hre.deployments.get("MarketResolver");

  const registrar = new hre.ethers.Contract(registrarDeploy.address, registrarDeploy.abi, signer);
  const resolver = new hre.ethers.Contract(resolverDeploy.address, resolverDeploy.abi, signer);
  const registry = new hre.ethers.Contract(ENS_REGISTRY, ["function resolver(bytes32) view returns (address)"], signer);

  console.log("\n── Step 1: Register subname ──");
  const slug = "test-" + Date.now().toString(36);
  const marketId = Math.floor(Math.random() * 100000);
  console.log(`Registering ${slug}.kowalski.eth (marketId=${marketId})...`);

  const tx1 = await registrar.registerMarket(slug, marketId, { gasLimit: 300_000 });
  await tx1.wait();
  console.log("✅ Subname registered");

  const node = ethers.namehash(`${slug}.kowalski.eth`);

  const ensResolver = await registry.resolver(node);
  console.log("ENS resolver:", ensResolver);
  console.log(ensResolver.toLowerCase() === resolverDeploy.address.toLowerCase() ? "✅ Resolver match" : "❌ Mismatch");

  console.log("\n── Step 2: Set text records ──");
  const tx2 = await resolver.setTexts(
    node,
    ["status", "outcome", "marketId"],
    ["ACTIVE", "pending", String(marketId)],
    { gasLimit: 300_000 },
  );
  await tx2.wait();

  const tx3 = await resolver.setAddr(node, deployer, { gasLimit: 100_000 });
  await tx3.wait();
  console.log("✅ Records set");

  console.log("\n── Step 3: Read back ──");
  console.log(`text("status")  = "${await resolver.text(node, "status")}"`);
  console.log(`text("outcome") = "${await resolver.text(node, "outcome")}"`);
  console.log(`addr()          = ${await resolver.addr(node)}`);

  console.log("\n── Step 4: ENSIP-10 resolve() ──");
  const textCalldata = resolver.interface.encodeFunctionData("text", [node, "status"]);
  const dnsName = dnsEncode(`${slug}.kowalski.eth`);

  try {
    const result = await resolver.resolve(dnsName, textCalldata);
    const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], result);
    console.log(`resolve() = "${decoded[0]}" ${decoded[0] === "ACTIVE" ? "✅" : "❌"}`);
  } catch (e: any) {
    console.log("resolve() error:", e.message?.slice(0, 100));
  }

  // analyze. prefix — should revert with OffchainLookup
  const analyzeDns = dnsEncode(`analyze.${slug}.kowalski.eth`);
  const analyzeNode = ethers.namehash(`analyze.${slug}.kowalski.eth`);
  const analyzeCalldata = resolver.interface.encodeFunctionData("text", [analyzeNode, "thesis"]);
  try {
    await resolver.resolve(analyzeDns, analyzeCalldata);
    console.log("❌ Should have reverted with OffchainLookup");
  } catch (e: any) {
    const isOffchain = e.data?.startsWith("0x556f1830") || e.message?.includes("OffchainLookup");
    console.log(isOffchain ? "✅ OffchainLookup revert — CCIP-Read works!" : "❌ Unexpected: " + e.message?.slice(0, 100));
  }

  console.log("\n── Done ──");
  console.log(`${slug}.kowalski.eth is live on Sepolia ENS 🎉`);
};

function dnsEncode(name: string): string {
  const labels = name.split(".");
  let result = "0x";
  for (const label of labels) {
    result += label.length.toString(16).padStart(2, "0");
    for (let i = 0; i < label.length; i++) {
      result += label.charCodeAt(i).toString(16).padStart(2, "0");
    }
  }
  result += "00";
  return result;
}

export default test_ens;
test_ens.tags = ["ENSTest"];
test_ens.dependencies = ["ENSOwnership"];
