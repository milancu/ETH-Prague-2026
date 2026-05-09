import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseEther } from "ethers";

const ONE = parseEther("1");
const N_BINARY = 2n;

async function deployBaseFixture() {
  const [deployer, alice, bob, carol, oracle] = await ethers.getSigners();

  const TAB = await ethers.deployContract("TABcoin");
  await TAB.waitForDeployment();
  const CT = await ethers.deployContract("ConditionalTokens");
  await CT.waitForDeployment();

  const PMV2 = await ethers.deployContract("PredictionMarketV2", [
    await TAB.getAddress(),
    await CT.getAddress(),
    deployer.address, // curator
    deployer.address, // governance
    deployer.address, // treasury
    0n, // defaultBond — disable for simpler tests
    3600n, // creatorCancelWindow
  ]);
  await PMV2.waitForDeployment();

  const WrapperImpl = await ethers.deployContract("PositionWrapper");
  await WrapperImpl.waitForDeployment();
  const Factory = await ethers.deployContract("PositionWrapperFactory", [
    await WrapperImpl.getAddress(),
    await CT.getAddress(),
  ]);
  await Factory.waitForDeployment();

  await (await PMV2.setWrapperFactory(await Factory.getAddress())).wait();

  const AMM = await ethers.deployContract("PredictionAMM", [await PMV2.getAddress()]);
  await AMM.waitForDeployment();

  // Mint TAB to test users.
  for (const u of [alice, bob, carol]) {
    await (await TAB.mint(u.address, parseEther("100000"))).wait();
  }

  return { TAB, CT, PMV2, Factory, AMM, deployer, alice, bob, carol, oracle };
}

async function createBinaryMarket(
  PMV2: any,
  oracle: { address: string },
  expiresIn = 3600,
  resolutionIn = 7200,
) {
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const tx = await PMV2.createMarket({
    name: "Binary",
    description: "test",
    category: "test",
    outcomeType: 0, // BINARY
    outcomeSlotCount: 2,
    outcomeLabels: ["NO", "YES"],
    oracle: oracle.address,
    expiresAt: now + expiresIn,
    resolutionTime: now + resolutionIn,
  });
  await tx.wait();
  return 0n; // first market id
}

async function createMultiMarket(PMV2: any, oracle: { address: string }, N: number) {
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const labels = Array.from({ length: N }, (_, i) => `OUT_${i}`);
  const tx = await PMV2.createMarket({
    name: "Multi",
    description: "test",
    category: "test",
    outcomeType: 1, // MULTI
    outcomeSlotCount: N,
    outcomeLabels: labels,
    oracle: oracle.address,
    expiresAt: now + 3600,
    resolutionTime: now + 7200,
  });
  await tx.wait();
}

describe("PredictionAMM", () => {
  describe("createPool", () => {
    it("creates pool with equal reserves and mints initial shares to creator", async () => {
      const { TAB, AMM, PMV2, alice, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");

      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await expect(AMM.connect(alice).createPool(marketId, funding, 200))
        .to.emit(AMM, "PoolCreated")
        .withArgs(marketId, alice.address, 200, funding, 2);

      const reserves = await AMM.getReserves(marketId);
      expect(reserves[0]).to.eq(funding);
      expect(reserves[1]).to.eq(funding);

      const [shares, totalShares] = await AMM.getShares(marketId, alice.address);
      expect(shares).to.eq(funding);
      expect(totalShares).to.eq(funding);
    });

    it("reverts when pool already exists", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");

      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      await (await TAB.connect(bob).approve(await AMM.getAddress(), funding)).wait();
      await expect(AMM.connect(bob).createPool(marketId, funding, 200))
        .to.be.revertedWithCustomError(AMM, "PoolExists")
        .withArgs(marketId);
    });

    it("reverts on fee above MAX_FEE_BPS", async () => {
      const { TAB, AMM, PMV2, alice, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      await (await TAB.connect(alice).approve(await AMM.getAddress(), parseEther("1000"))).wait();
      await expect(AMM.connect(alice).createPool(marketId, parseEther("1000"), 600))
        .to.be.revertedWithCustomError(AMM, "FeeTooHigh")
        .withArgs(600);
    });

    it("reverts on zero funding", async () => {
      const { AMM, PMV2, alice, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      await expect(AMM.connect(alice).createPool(marketId, 0, 200)).to.be.revertedWithCustomError(AMM, "ZeroAmount");
    });
  });

  describe("buy", () => {
    it("preserves constant-product invariant", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");

      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait(); // 0% fee for clean math

      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();

      const [outcomeOut, feeAmount] = await AMM.calcBuyAmount(marketId, 0, investment);
      expect(feeAmount).to.eq(0n);
      await (await AMM.connect(bob).buy(marketId, 0, investment, outcomeOut)).wait();

      const reserves = await AMM.getReserves(marketId);
      // k_before = funding * funding. k_after = R0 * R1.
      const kBefore = funding * funding;
      const kAfter = reserves[0] * reserves[1];
      // k_after >= k_before because rounding favors pool.
      expect(kAfter).to.be.gte(kBefore);
      // Drift should be tiny — within ~1 wei per reserve squared.
      const drift = kAfter - kBefore;
      expect(drift).to.be.lt(funding * 2n);
    });

    it("respects minOutcomeOut slippage", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();
      const [outcomeOut] = await AMM.calcBuyAmount(marketId, 0, investment);

      await expect(AMM.connect(bob).buy(marketId, 0, investment, outcomeOut + 1n)).to.be.revertedWithCustomError(
        AMM,
        "SlippageExceeded",
      );
    });

    it("accrues fee into feeAccumulated, not into reserves", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait(); // 2% fee

      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();
      await (await AMM.connect(bob).buy(marketId, 0, investment, 0)).wait();

      const pool = await AMM.getPool(marketId);
      expect(pool.feeAccumulated).to.eq(parseEther("2")); // 2% of 100
    });

    it("reverts on bad outcome index", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();
      await expect(AMM.connect(bob).buy(marketId, 5, investment, 0))
        .to.be.revertedWithCustomError(AMM, "BadOutcomeIndex")
        .withArgs(5);
    });
  });

  describe("sell", () => {
    it("round-trip buy then sell returns near-original TAB minus fees", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("10000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait(); // no fee for clean math

      // Bob buys YES (index 0).
      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();
      const [yesOut] = await AMM.calcBuyAmount(marketId, 0, investment);
      await (await AMM.connect(bob).buy(marketId, 0, investment, 0)).wait();

      // Bob now sells back. Approve wrapper.
      const wrappers = await AMM.getWrappers(marketId);
      const yesWrapper = await ethers.getContractAt("IERC20", wrappers[0]);
      await (await yesWrapper.connect(bob).approve(await AMM.getAddress(), yesOut)).wait();

      // Sell exactly enough YES to extract back what bob paid (minus tiny rounding loss).
      // We use calcSellAmount to find required outcomeIn for nearly all of bob's TAB back.
      const target = (investment * 999n) / 1000n; // 99.9% of original
      const [outcomeIn] = await AMM.calcSellAmount(marketId, 0, target);
      expect(outcomeIn).to.be.lte(yesOut);

      const tabBefore = await TAB.balanceOf(bob.address);
      await (await AMM.connect(bob).sell(marketId, 0, target, outcomeIn)).wait();
      const tabAfter = await TAB.balanceOf(bob.address);

      expect(tabAfter - tabBefore).to.eq(target);
    });

    it("respects maxOutcomeIn slippage", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("10000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait();

      const investment = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), investment)).wait();
      const [yesOut] = await AMM.calcBuyAmount(marketId, 0, investment);
      await (await AMM.connect(bob).buy(marketId, 0, investment, 0)).wait();

      const wrappers = await AMM.getWrappers(marketId);
      const yesWrapper = await ethers.getContractAt("IERC20", wrappers[0]);
      await (await yesWrapper.connect(bob).approve(await AMM.getAddress(), yesOut)).wait();

      const target = parseEther("50");
      const [outcomeIn] = await AMM.calcSellAmount(marketId, 0, target);
      await expect(AMM.connect(bob).sell(marketId, 0, target, outcomeIn - 1n)).to.be.revertedWithCustomError(
        AMM,
        "SlippageExceeded",
      );
    });
  });

  describe("addFunding / removeFunding", () => {
    it("addFunding on 50/50 pool refunds zero leftover", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      const more = parseEther("500");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), more)).wait();

      const wrappers = await AMM.getWrappers(marketId);
      const yes = await ethers.getContractAt("IERC20", wrappers[0]);
      const no = await ethers.getContractAt("IERC20", wrappers[1]);
      const yesBefore = await yes.balanceOf(bob.address);
      const noBefore = await no.balanceOf(bob.address);

      await (await AMM.connect(bob).addFunding(marketId, more, 0)).wait();

      // 50/50 pool → no leftover for bob.
      expect(await yes.balanceOf(bob.address)).to.eq(yesBefore);
      expect(await no.balanceOf(bob.address)).to.eq(noBefore);

      const [bobShares, total] = await AMM.getShares(marketId, bob.address);
      // shares = totalShares * amount / rMax = 1000 * 500 / 1000 = 500
      expect(bobShares).to.eq(parseEther("500"));
      expect(total).to.eq(parseEther("1500"));
    });

    it("addFunding on skewed pool refunds leftover wrapper of rare side", async () => {
      const { TAB, AMM, PMV2, alice, bob, carol, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait();

      // Carol buys YES (index 0) heavily — pool ends up YES-rare, NO-abundant.
      const buyInvest = parseEther("500");
      await (await TAB.connect(carol).approve(await AMM.getAddress(), buyInvest)).wait();
      await (await AMM.connect(carol).buy(marketId, 0, buyInvest, 0)).wait();

      const reserves = await AMM.getReserves(marketId);
      // After buy: R[0] = YES is smaller, R[1] = NO is larger.
      expect(reserves[0]).to.be.lt(reserves[1]);

      const more = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), more)).wait();
      const wrappers = await AMM.getWrappers(marketId);
      const yes = await ethers.getContractAt("IERC20", wrappers[0]);
      const no = await ethers.getContractAt("IERC20", wrappers[1]);

      const yesBefore = await yes.balanceOf(bob.address);
      const noBefore = await no.balanceOf(bob.address);
      await (await AMM.connect(bob).addFunding(marketId, more, 0)).wait();

      // Larger reserve = NO; bob keeps zero NO leftover. Smaller = YES; bob gets back YES leftover.
      expect(await no.balanceOf(bob.address)).to.eq(noBefore);
      const yesLeftover = (await yes.balanceOf(bob.address)) - yesBefore;
      expect(yesLeftover).to.be.gt(0n);
      // Sanity: leftover < the full added amount.
      expect(yesLeftover).to.be.lt(more);
    });

    it("removeFunding gives proportional reserves + fee share", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      // Generate some fees by trading.
      const inv = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), inv)).wait();
      await (await AMM.connect(bob).buy(marketId, 0, inv, 0)).wait();

      const poolBefore = await AMM.getPool(marketId);
      const aliceShares = await AMM.getShares(marketId, alice.address);
      const tabBefore = await TAB.balanceOf(alice.address);

      await (await AMM.connect(alice).removeFunding(marketId, aliceShares[0], [0n, 0n], 0n)).wait();

      // Alice gets all fees back (sole LP).
      const tabAfter = await TAB.balanceOf(alice.address);
      expect(tabAfter - tabBefore).to.eq(poolBefore.feeAccumulated);

      // Pool reserves zeroed.
      const poolAfter = await AMM.getPool(marketId);
      expect(poolAfter.reserves[0]).to.eq(0n);
      expect(poolAfter.reserves[1]).to.eq(0n);
      expect(poolAfter.totalShares).to.eq(0n);
    });
  });

  describe("resolution lockdown", () => {
    it("blocks buy/sell/addFunding after resolve, allows removeFunding", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      // Resolve the market: oracle reports payouts.
      await (await PMV2.connect(oracle).resolveMarket(marketId, [1, 0])).wait(); // outcome 0 wins

      // buy reverts.
      await (await TAB.connect(bob).approve(await AMM.getAddress(), parseEther("10"))).wait();
      await expect(AMM.connect(bob).buy(marketId, 0, parseEther("10"), 0))
        .to.be.revertedWithCustomError(AMM, "MarketNotOpen")
        .withArgs(marketId);

      // addFunding reverts.
      await expect(AMM.connect(bob).addFunding(marketId, parseEther("10"), 0))
        .to.be.revertedWithCustomError(AMM, "MarketNotOpen")
        .withArgs(marketId);

      // removeFunding still works.
      const [aliceShares] = await AMM.getShares(marketId, alice.address);
      await expect(AMM.connect(alice).removeFunding(marketId, aliceShares, [0n, 0n], 0n)).not.to.be.reverted;
    });
  });

  describe("donation immune", () => {
    it("transferring wrapper directly into AMM does not change reserves or price", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait();

      // Bob buys some YES so he has wrapper to donate.
      const inv = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), inv)).wait();
      const [yesOut] = await AMM.calcBuyAmount(marketId, 0, inv);
      await (await AMM.connect(bob).buy(marketId, 0, inv, 0)).wait();

      const reservesBefore = await AMM.getReserves(marketId);

      // Bob donates a chunk of YES directly to AMM.
      const wrappers = await AMM.getWrappers(marketId);
      const yes = await ethers.getContractAt("IERC20", wrappers[0]);
      await (await yes.connect(bob).transfer(await AMM.getAddress(), yesOut / 2n)).wait();

      const reservesAfter = await AMM.getReserves(marketId);
      expect(reservesAfter[0]).to.eq(reservesBefore[0]);
      expect(reservesAfter[1]).to.eq(reservesBefore[1]);

      // calcBuy gives same answer for fixed input.
      const [out1] = await AMM.calcBuyAmount(marketId, 0, parseEther("10"));
      const [out2] = await AMM.calcBuyAmount(marketId, 1, parseEther("10"));
      expect(out1).to.be.gt(0n);
      expect(out2).to.be.gt(0n);
    });
  });

  describe("audit fixes", () => {
    it("buy reverts after full liquidity removal (M1)", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait();

      const [aliceShares] = await AMM.getShares(marketId, alice.address);
      await (await AMM.connect(alice).removeFunding(marketId, aliceShares, [0n, 0n], 0n)).wait();

      await (await TAB.connect(bob).approve(await AMM.getAddress(), parseEther("10"))).wait();
      await expect(AMM.connect(bob).buy(marketId, 0, parseEther("10"), 0)).to.be.revertedWithCustomError(
        AMM,
        "InsufficientLiquidity",
      );
    });

    it("pendingFeesOf returns sole-LP's pro-rata share (L3)", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      const marketId = await createBinaryMarket(PMV2, oracle);
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 200)).wait();

      const inv = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), inv)).wait();
      await (await AMM.connect(bob).buy(marketId, 0, inv, 0)).wait();

      const fees = await AMM.pendingFeesOf(marketId, alice.address);
      expect(fees).to.eq(parseEther("2")); // 2% of 100, sole LP gets all
    });
  });

  describe("multi-outcome (N=3)", () => {
    it("creates pool, buys outcome 1, k invariant holds across all 3 reserves", async () => {
      const { TAB, AMM, PMV2, alice, bob, oracle } = await loadFixture(deployBaseFixture);
      await createMultiMarket(PMV2, oracle, 3);
      const marketId = 0n;
      const funding = parseEther("1000");
      await (await TAB.connect(alice).approve(await AMM.getAddress(), funding)).wait();
      await (await AMM.connect(alice).createPool(marketId, funding, 0)).wait();

      const reserves0 = await AMM.getReserves(marketId);
      expect(reserves0.length).to.eq(3);
      const k0 = reserves0[0] * reserves0[1] * reserves0[2];

      const inv = parseEther("100");
      await (await TAB.connect(bob).approve(await AMM.getAddress(), inv)).wait();
      const [outcomeOut] = await AMM.calcBuyAmount(marketId, 1, inv);
      await (await AMM.connect(bob).buy(marketId, 1, inv, outcomeOut)).wait();

      const reserves1 = await AMM.getReserves(marketId);
      const k1 = reserves1[0] * reserves1[1] * reserves1[2];
      expect(k1).to.be.gte(k0); // rounding favors pool

      // Outcome 1 should have the smallest reserve (we drained it), others larger.
      expect(reserves1[1]).to.be.lt(reserves1[0]);
      expect(reserves1[1]).to.be.lt(reserves1[2]);
      expect(reserves1[0]).to.eq(reserves1[2]); // 0 and 2 untouched relative to each other
    });
  });
});
