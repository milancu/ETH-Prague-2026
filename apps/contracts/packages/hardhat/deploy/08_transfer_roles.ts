import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { isAddress, getAddress } from "ethers";

// Deployer holds curator/governance/treasury after step 03. This script transfers
// each role to the address from .env if set and different from deployer. Governance
// must be transferred LAST because transferCurator/Treasury are also onlyGovernance.
const deploy_transfer_roles: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
  if (isLocal) {
    console.log("⏭  Skipping role transfer on local network.");
    return;
  }

  const pmv2 = await hre.ethers.getContract<any>("PredictionMarketV2", deployer);

  const targets: Array<{ name: "curator" | "treasury" | "governance"; envKey: string; setter: string }> = [
    { name: "curator", envKey: "CURATOR", setter: "transferCurator" },
    { name: "treasury", envKey: "TREASURY", setter: "transferTreasury" },
    { name: "governance", envKey: "GOVERNANCE", setter: "transferGovernance" },
  ];

  for (const { name, envKey, setter } of targets) {
    const raw = process.env[envKey];
    if (!raw) {
      console.log(`⏭  ${envKey} not set — keeping deployer as ${name}.`);
      continue;
    }
    if (!isAddress(raw)) {
      console.log(`⚠️  ${envKey}=${raw} is not a valid address — skipping ${name} transfer.`);
      continue;
    }
    const target = getAddress(raw);
    const current: string = await pmv2[name]();
    if (getAddress(current) === target) {
      console.log(`⏭  ${name} already ${target} — skipping.`);
      continue;
    }
    if (getAddress(current) !== getAddress(deployer)) {
      console.log(`⚠️  ${name} is ${current}, deployer is ${deployer} — cannot transfer.`);
      continue;
    }
    const tx = await pmv2[setter](target, { gasLimit: 100_000 });
    await tx.wait();
    console.log(`✅ PredictionMarketV2.${setter}(${target})`);
  }
};

export default deploy_transfer_roles;
deploy_transfer_roles.tags = ["TransferRoles"];
deploy_transfer_roles.dependencies = ["PredictionMarketV2", "PositionWrapperFactory", "TabClob"];
