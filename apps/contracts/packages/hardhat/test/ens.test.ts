import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MarketResolver,
  MarketSubnameRegistrar,
  MockENSRegistry,
} from "../typechain-types";

// Dedicated wallet for gateway signing so we have access to signingKey
const GATEWAY_SIGNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const gatewayWallet = new ethers.Wallet(GATEWAY_SIGNER_PK);

describe("ENS Integration", function () {
  let deployer: SignerWithAddress;
  let other: SignerWithAddress;
  let resolver: MarketResolver;
  let registrar: MarketSubnameRegistrar;
  let registry: MockENSRegistry;

  const PARENT_NODE = ethers.namehash("kowalski.eth");
  const ETH_NODE = ethers.namehash("eth");
  const ETH_LABEL = ethers.id("eth");
  const KOWALSKI_LABEL = ethers.id("kowalski");
  const GATEWAY_URL = "http://localhost:8000/v1/ens-gateway/{sender}/{data}.json";

  beforeEach(async function () {
    [deployer, other] = await ethers.getSigners();

    // Deploy mock ENS registry
    const MockRegistry = await ethers.getContractFactory("MockENSRegistry");
    registry = await MockRegistry.deploy();

    // Claim eth TLD and kowalski.eth
    await registry.claimName(ethers.ZeroHash, ETH_LABEL);
    await registry.claimName(ETH_NODE, KOWALSKI_LABEL);

    // Deploy MarketResolver with the deterministic gateway wallet
    const Resolver = await ethers.getContractFactory("MarketResolver");
    resolver = await Resolver.deploy(
      deployer.address,
      gatewayWallet.address,
      [GATEWAY_URL],
    );

    // Deploy MarketSubnameRegistrar
    const Registrar = await ethers.getContractFactory("MarketSubnameRegistrar");
    registrar = await Registrar.deploy(
      await registry.getAddress(),
      ethers.ZeroAddress, // no NameWrapper in local test
      await resolver.getAddress(),
      PARENT_NODE,
      deployer.address,
      false, // useNameWrapper = false
    );

    // Transfer kowalski.eth ownership to registrar in the mock registry
    await registry.setOwner(PARENT_NODE, await registrar.getAddress());
  });

  // ── MarketResolver: Track 1 (text records) ──────────────────

  describe("MarketResolver — Track 1: text records", function () {
    const node = ethers.namehash("slavia.kowalski.eth");

    it("setText and text() return stored value", async function () {
      await resolver.setText(node, "outcome", "yes");
      expect(await resolver.text(node, "outcome")).to.equal("yes");
    });

    it("setTexts stores multiple records", async function () {
      await resolver.setTexts(
        node,
        ["status", "outcome", "payouts"],
        ["RESOLVED", "yes", "[1, 0]"],
      );
      expect(await resolver.text(node, "status")).to.equal("RESOLVED");
      expect(await resolver.text(node, "outcome")).to.equal("yes");
      expect(await resolver.text(node, "payouts")).to.equal("[1, 0]");
    });

    it("setAddr and addr() return stored address", async function () {
      await resolver.setAddr(node, deployer.address);
      expect(await resolver.addr(node)).to.equal(deployer.address);
    });

    it("reverts setText from non-admin", async function () {
      await expect(
        resolver.connect(other).setText(node, "outcome", "yes"),
      ).to.be.revertedWithCustomError(resolver, "NotAdmin");
    });

    it("reverts setAddr from non-admin", async function () {
      await expect(
        resolver.connect(other).setAddr(node, deployer.address),
      ).to.be.revertedWithCustomError(resolver, "NotAdmin");
    });

    it("supportsInterface returns true for ITextResolver", async function () {
      expect(await resolver.supportsInterface("0x59d1d43c")).to.be.true;
    });

    it("supportsInterface returns true for IAddrResolver", async function () {
      expect(await resolver.supportsInterface("0x3b3b57de")).to.be.true;
    });

    it("supportsInterface returns true for IExtendedResolver (ENSIP-10)", async function () {
      expect(await resolver.supportsInterface("0x9061b923")).to.be.true;
    });
  });

  // ── MarketResolver: Track 2 (CCIP-Read) ─────────────────────

  describe("MarketResolver — Track 2: CCIP-Read", function () {
    it("resolve() reverts with OffchainLookup for analyze. prefix", async function () {
      // DNS-encode "analyze.slavia.kowalski.eth"
      const dnsName = dnsEncode("analyze.slavia.kowalski.eth");
      // Build text(node, "thesis") calldata
      const node = ethers.namehash("analyze.slavia.kowalski.eth");
      const textIface = new ethers.Interface(["function text(bytes32 node, string key)"]);
      const calldata = textIface.encodeFunctionData("text", [node, "thesis"]);

      await expect(resolver.resolve(dnsName, calldata))
        .to.be.revertedWithCustomError(resolver, "OffchainLookup");
    });

    it("resolve() returns text record for non-analyze names", async function () {
      const node = ethers.namehash("slavia.kowalski.eth");
      await resolver.setText(node, "outcome", "yes");

      const dnsName = dnsEncode("slavia.kowalski.eth");
      const textIface = new ethers.Interface(["function text(bytes32 node, string key)"]);
      const calldata = textIface.encodeFunctionData("text", [node, "outcome"]);

      const result = await resolver.resolve(dnsName, calldata);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], result);
      expect(decoded[0]).to.equal("yes");
    });

    it("resolveWithProof verifies valid gateway signature", async function () {
      const dnsName = dnsEncode("analyze.slavia.kowalski.eth");
      const textIface = new ethers.Interface(["function text(bytes32 node, string key)"]);
      const node = ethers.namehash("analyze.slavia.kowalski.eth");
      const originalData = textIface.encodeFunctionData("text", [node, "thesis"]);

      const resultData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string"],
        ["Slavia favored at 0.65 implied."],
      );
      const expires = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const request = ethers.concat([dnsName, originalData]);

      const resolverAddr = await resolver.getAddress();
      const digest = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes2", "address", "uint64", "bytes32", "bytes32"],
          [
            "0x1900",
            resolverAddr,
            expires,
            ethers.keccak256(request),
            ethers.keccak256(resultData),
          ],
        ),
      );

      const sigBytes = gatewayWallet.signingKey.sign(digest).serialized;

      const response = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint64", "bytes"],
        [resultData, expires, sigBytes],
      );

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes"],
        [dnsName, originalData],
      );

      const decoded = await resolver.resolveWithProof(response, extraData);
      const text = ethers.AbiCoder.defaultAbiCoder().decode(["string"], decoded);
      expect(text[0]).to.equal("Slavia favored at 0.65 implied.");
    });

    it("resolveWithProof reverts on expired signature", async function () {
      const dnsName = dnsEncode("analyze.slavia.kowalski.eth");
      const textIface = new ethers.Interface(["function text(bytes32 node, string key)"]);
      const node = ethers.namehash("analyze.slavia.kowalski.eth");
      const originalData = textIface.encodeFunctionData("text", [node, "thesis"]);

      const resultData = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["stale"]);
      const expires = BigInt(1); // already expired

      const request = ethers.concat([dnsName, originalData]);
      const resolverAddr = await resolver.getAddress();
      const digest = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes2", "address", "uint64", "bytes32", "bytes32"],
          ["0x1900", resolverAddr, expires, ethers.keccak256(request), ethers.keccak256(resultData)],
        ),
      );
      const sigBytes = gatewayWallet.signingKey.sign(digest).serialized;

      const response = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint64", "bytes"],
        [resultData, expires, sigBytes],
      );
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes"],
        [dnsName, originalData],
      );

      await expect(resolver.resolveWithProof(response, extraData))
        .to.be.revertedWithCustomError(resolver, "SignatureExpired");
    });

    it("resolveWithProof reverts on wrong signer", async function () {
      const dnsName = dnsEncode("analyze.slavia.kowalski.eth");
      const textIface = new ethers.Interface(["function text(bytes32 node, string key)"]);
      const node = ethers.namehash("analyze.slavia.kowalski.eth");
      const originalData = textIface.encodeFunctionData("text", [node, "thesis"]);

      const resultData = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["fake"]);
      const expires = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const request = ethers.concat([dnsName, originalData]);
      const resolverAddr = await resolver.getAddress();
      const digest = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes2", "address", "uint64", "bytes32", "bytes32"],
          ["0x1900", resolverAddr, expires, ethers.keccak256(request), ethers.keccak256(resultData)],
        ),
      );

      // Sign with a different wallet (wrong signer)
      const wrongWallet = ethers.Wallet.createRandom();
      const sigBytes = wrongWallet.signingKey.sign(digest).serialized;

      const response = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint64", "bytes"],
        [resultData, expires, sigBytes],
      );
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes"],
        [dnsName, originalData],
      );

      await expect(resolver.resolveWithProof(response, extraData))
        .to.be.revertedWithCustomError(resolver, "InvalidSignature");
    });
  });

  // ── MarketSubnameRegistrar ──────────────────────────────────

  describe("MarketSubnameRegistrar", function () {
    it("registerMarket creates a subname and tracks it", async function () {
      const tx = await registrar.registerMarket("slavia-titul-2026", 5);
      await tx.wait();

      const expectedNode = ethers.namehash("slavia-titul-2026.kowalski.eth");
      expect(await registrar.marketNodes(5)).to.equal(expectedNode);
      expect(await registrar.nodeToMarketId(expectedNode)).to.equal(5);
      expect(await registrar.slugTaken("slavia-titul-2026")).to.be.true;

      // ENS registry should show the subname
      expect(await registry.owner(expectedNode)).to.equal(deployer.address);
      expect(await registry.resolver(expectedNode)).to.equal(await resolver.getAddress());
    });

    it("reverts on duplicate slug", async function () {
      await registrar.registerMarket("btc-200k", 1);
      await expect(registrar.registerMarket("btc-200k", 2))
        .to.be.revertedWithCustomError(registrar, "SlugAlreadyTaken");
    });

    it("reverts on duplicate marketId", async function () {
      await registrar.registerMarket("btc-200k", 1);
      await expect(registrar.registerMarket("eth-10k", 1))
        .to.be.revertedWithCustomError(registrar, "MarketAlreadyRegistered");
    });

    it("reverts from non-admin", async function () {
      await expect(registrar.connect(other).registerMarket("test", 99))
        .to.be.revertedWithCustomError(registrar, "NotAdmin");
    });

    it("emits SubnameRegistered event", async function () {
      const expectedNode = ethers.namehash("my-market.kowalski.eth");
      await expect(registrar.registerMarket("my-market", 42))
        .to.emit(registrar, "SubnameRegistered")
        .withArgs(42, "my-market", expectedNode);
    });
  });

  // ── Admin management ────────────────────────────────────────

  describe("Admin management", function () {
    it("MarketResolver: transferAdmin works", async function () {
      await resolver.transferAdmin(other.address);
      expect(await resolver.admin()).to.equal(other.address);
    });

    it("MarketResolver: transferAdmin reverts from non-admin", async function () {
      await expect(resolver.connect(other).transferAdmin(other.address))
        .to.be.revertedWithCustomError(resolver, "NotAdmin");
    });

    it("MarketResolver: setSigner works", async function () {
      await resolver.setSigner(other.address);
      expect(await resolver.signer()).to.equal(other.address);
    });

    it("MarketSubnameRegistrar: transferAdmin works", async function () {
      await registrar.transferAdmin(other.address);
      expect(await registrar.admin()).to.equal(other.address);
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────

function dnsEncode(name: string): string {
  const labels = name.split(".");
  let result = "0x";
  for (const label of labels) {
    const len = label.length;
    result += len.toString(16).padStart(2, "0");
    for (let i = 0; i < len; i++) {
      result += label.charCodeAt(i).toString(16).padStart(2, "0");
    }
  }
  result += "00"; // null terminator
  return result;
}
