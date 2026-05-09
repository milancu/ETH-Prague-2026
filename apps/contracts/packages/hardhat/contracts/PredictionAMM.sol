// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPredictionMarketV2 {
    enum OutcomeType {
        BINARY,
        MULTI,
        SCALAR
    }

    struct Market {
        address creator;
        address oracle;
        bytes32 questionId;
        bytes32 conditionId;
        uint256 outcomeSlotCount;
        OutcomeType outcomeType;
        string name;
        string description;
        string category;
        string[] outcomeLabels;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 resolutionTime;
        uint256 bondAmount;
        uint256 lockedCollateral;
        bool bondClaimed;
        bool bondSlashed;
        bool verified;
        bool canceled;
        bool resolved;
        bool paused;
    }

    function getMarket(uint256 marketId) external view returns (Market memory);
    function collateral() external view returns (IERC20);
    function ct() external view returns (address);
    function wrapperFactory() external view returns (address);
    function splitAndWrap(uint256 marketId, uint256 amount, uint256[] calldata wrapIndexSets) external;
    function mergeFrom(uint256 marketId, uint256[] calldata partition, uint256 amount) external;
}

interface IPositionWrapperFactory {
    function wrapperOf(bytes32 key) external view returns (address);
    function key(address collateral, bytes32 conditionId, uint256 indexSet) external pure returns (bytes32);
    function getOrCreateWrapper(address collateral, bytes32 conditionId, uint256 indexSet) external returns (address);
}

interface IPositionWrapperUnwrap {
    function unwrap(uint256 amount) external;
}

/// @title PredictionAMM
/// @notice Multi-outcome Fixed Product Market Maker (FPMM) atop PredictionMarketV2.
///         Constant-product invariant Π reserves[i] = k. One pool per marketId.
///         Pool stores ERC-20 wrapped outcome positions (same tokens TabClob trades),
///         so AMM and CLOB price-arbitrage trivially. Internal accounting for reserves
///         protects against donation drift. LP shares are non-transferable.
contract PredictionAMM is ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /* ---------- immutables ---------- */

    IERC20 public immutable collateral;
    IPredictionMarketV2 public immutable pmv2;
    IPositionWrapperFactory public immutable wrapperFactory;
    address public immutable ct;

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 500; // 5%
    uint8 public constant MAX_OUTCOMES = 16;

    /* ---------- per-market state ---------- */

    struct Pool {
        bool exists;
        uint8 outcomeSlotCount;
        uint16 feeBps;
        bytes32 conditionId;
        uint256 totalShares;
        uint256 feeAccumulated; // TAB held for LPs, paid pro-rata on removeFunding
        uint256[] reserves; // length == outcomeSlotCount; pool's wrapper balance per outcome
        address[] wrappers; // length == outcomeSlotCount; ERC-20 wrapper per outcome (indexSet = 1<<i)
    }

    mapping(uint256 marketId => Pool) private _pools;
    mapping(uint256 marketId => mapping(address => uint256)) public sharesOf;

    bool public ctApprovalSetForPmv2;

    /* ---------- events ---------- */

    event PoolCreated(
        uint256 indexed marketId,
        address indexed creator,
        uint16 feeBps,
        uint256 initialFunding,
        uint8 outcomeSlotCount
    );
    event FundingAdded(
        uint256 indexed marketId,
        address indexed funder,
        uint256 amountIn,
        uint256 sharesMinted,
        uint256[] reservesAfter
    );
    event FundingRemoved(
        uint256 indexed marketId,
        address indexed funder,
        uint256 sharesBurned,
        uint256[] outcomeOut,
        uint256 feeOut
    );
    event Bought(
        uint256 indexed marketId,
        address indexed buyer,
        uint8 outcomeIndex,
        uint256 investmentAmount,
        uint256 feeAmount,
        uint256 outcomeOut
    );
    event Sold(
        uint256 indexed marketId,
        address indexed seller,
        uint8 outcomeIndex,
        uint256 returnAmount,
        uint256 feeAmount,
        uint256 outcomeIn
    );

    /* ---------- errors ---------- */

    error ZeroAmount();
    error ZeroAddress();
    error PoolExists(uint256 marketId);
    error PoolMissing(uint256 marketId);
    error MarketNotOpen(uint256 marketId);
    error FeeTooHigh(uint16 feeBps);
    error TooManyOutcomes(uint8 slots);
    error TooFewOutcomes(uint8 slots);
    error BadOutcomeIndex(uint8 outcomeIndex);
    error SlippageExceeded();
    error InsufficientLiquidity();
    error MinOutLengthMismatch();
    error WrapperNotRegistered();

    constructor(IPredictionMarketV2 _pmv2) {
        if (address(_pmv2) == address(0)) revert ZeroAddress();
        IERC20 _collateral = _pmv2.collateral();
        address _factory = _pmv2.wrapperFactory();
        address _ct = _pmv2.ct();
        if (address(_collateral) == address(0)) revert ZeroAddress();
        if (_factory == address(0)) revert ZeroAddress();
        if (_ct == address(0)) revert ZeroAddress();

        pmv2 = _pmv2;
        collateral = _collateral;
        wrapperFactory = IPositionWrapperFactory(_factory);
        ct = _ct;

        // PMv2 pulls TAB from us during splitAndWrap.
        _collateral.forceApprove(address(_pmv2), type(uint256).max);
    }

    /* ---------- views ---------- */

    function getPool(uint256 marketId) external view returns (Pool memory) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        return p;
    }

    function getReserves(uint256 marketId) external view returns (uint256[] memory) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        return p.reserves;
    }

    function getWrappers(uint256 marketId) external view returns (address[] memory) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        return p.wrappers;
    }

    function getShares(uint256 marketId, address user) external view returns (uint256 shares, uint256 totalShares) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        return (sharesOf[marketId][user], p.totalShares);
    }

    /// @notice Pro-rata TAB fees a user would receive if they removed all their shares right now.
    function pendingFeesOf(uint256 marketId, address user) external view returns (uint256) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        if (p.totalShares == 0) return 0;
        return Math.mulDiv(p.feeAccumulated, sharesOf[marketId][user], p.totalShares);
    }

    /// @notice Quote: how much of outcome `outcomeIndex` would `investmentAmount` TAB buy?
    function calcBuyAmount(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 investmentAmount
    ) external view returns (uint256 outcomeOut, uint256 feeAmount) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        if (outcomeIndex >= p.outcomeSlotCount) revert BadOutcomeIndex(outcomeIndex);
        if (investmentAmount == 0) revert ZeroAmount();

        feeAmount = (investmentAmount * p.feeBps) / BPS;
        uint256 netIn = investmentAmount - feeAmount;
        outcomeOut = _calcBuyAmount(p.reserves, outcomeIndex, netIn);
    }

    /// @notice Quote: how much of outcome `outcomeIndex` must a seller send to receive `returnAmount` TAB?
    function calcSellAmount(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 returnAmount
    ) external view returns (uint256 outcomeIn, uint256 feeAmount) {
        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        if (outcomeIndex >= p.outcomeSlotCount) revert BadOutcomeIndex(outcomeIndex);
        if (returnAmount == 0) revert ZeroAmount();

        // grossOut = returnAmount / (1 - feeBps/BPS), rounded UP
        uint256 grossOut = Math.mulDiv(returnAmount, BPS, BPS - p.feeBps, Math.Rounding.Ceil);
        feeAmount = grossOut - returnAmount;
        outcomeIn = _calcSellOutcomeIn(p.reserves, outcomeIndex, grossOut);
    }

    /* ---------- LP: createPool ---------- */

    /// @notice Anyone can create a pool for a binary or multi-outcome market.
    ///         Initial funding splits 1:1 across all outcomes (50/50/.../50 prices).
    function createPool(
        uint256 marketId,
        uint256 initialFunding,
        uint16 feeBps
    ) external nonReentrant returns (uint256 sharesMinted) {
        if (initialFunding == 0) revert ZeroAmount();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh(feeBps);

        Pool storage p = _pools[marketId];
        if (p.exists) revert PoolExists(marketId);

        IPredictionMarketV2.Market memory m = pmv2.getMarket(marketId);
        if (m.resolved || m.canceled || m.paused) revert MarketNotOpen(marketId);
        if (m.outcomeSlotCount < 2) revert TooFewOutcomes(uint8(m.outcomeSlotCount));
        if (m.outcomeSlotCount > MAX_OUTCOMES) revert TooManyOutcomes(uint8(m.outcomeSlotCount));

        uint8 N = uint8(m.outcomeSlotCount);

        // Initialize pool storage.
        p.exists = true;
        p.outcomeSlotCount = N;
        p.feeBps = feeBps;
        p.conditionId = m.conditionId;
        p.reserves = new uint256[](N);
        p.wrappers = new address[](N);

        // Pull TAB and splitAndWrap into N wrappers (one per outcome).
        collateral.safeTransferFrom(msg.sender, address(this), initialFunding);

        uint256[] memory wrapIndexSets = new uint256[](N);
        for (uint256 i = 0; i < N; i++) wrapIndexSets[i] = uint256(1) << i;
        pmv2.splitAndWrap(marketId, initialFunding, wrapIndexSets);

        // Resolve wrapper addresses (factory created them deterministically inside splitAndWrap).
        for (uint256 i = 0; i < N; i++) {
            bytes32 k = wrapperFactory.key(address(collateral), m.conditionId, wrapIndexSets[i]);
            address w = wrapperFactory.wrapperOf(k);
            if (w == address(0)) revert WrapperNotRegistered();
            p.wrappers[i] = w;
            p.reserves[i] = initialFunding;
        }

        // First LP: 1 share per unit of funding.
        sharesMinted = initialFunding;
        p.totalShares = sharesMinted;
        sharesOf[marketId][msg.sender] = sharesMinted;

        emit PoolCreated(marketId, msg.sender, feeBps, initialFunding, N);
    }

    /* ---------- LP: addFunding ---------- */

    /// @notice Add liquidity to an existing pool. Maintains the pool's price by absorbing
    ///         outcome tokens proportionally; refunds any leftover wrapper to the LP.
    function addFunding(
        uint256 marketId,
        uint256 amount,
        uint256 minSharesOut
    ) external nonReentrant returns (uint256 sharesMinted) {
        if (amount == 0) revert ZeroAmount();

        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);

        IPredictionMarketV2.Market memory m = pmv2.getMarket(marketId);
        if (m.resolved || m.canceled || m.paused) revert MarketNotOpen(marketId);

        uint8 N = p.outcomeSlotCount;

        // Find max reserve — that side absorbs the full `amount`; others scale down.
        uint256 rMax;
        for (uint256 i = 0; i < N; i++) {
            if (p.reserves[i] > rMax) rMax = p.reserves[i];
        }
        if (rMax == 0) revert InsufficientLiquidity();

        // Pull TAB and splitAndWrap into N wrappers; AMM receives `amount` of each.
        collateral.safeTransferFrom(msg.sender, address(this), amount);

        uint256[] memory wrapIndexSets = new uint256[](N);
        for (uint256 i = 0; i < N; i++) wrapIndexSets[i] = uint256(1) << i;
        pmv2.splitAndWrap(marketId, amount, wrapIndexSets);

        // Absorb proportionally; refund leftover for outcomes where reserve < rMax.
        uint256[] memory reservesAfter = new uint256[](N);
        for (uint256 i = 0; i < N; i++) {
            // delta_i = amount * reserves[i] / rMax  (rounded down — leftover slightly favors LP)
            uint256 delta = Math.mulDiv(amount, p.reserves[i], rMax);
            uint256 leftover = amount - delta;
            p.reserves[i] += delta;
            reservesAfter[i] = p.reserves[i];
            if (leftover > 0) {
                IERC20(p.wrappers[i]).safeTransfer(msg.sender, leftover);
            }
        }

        // shares = totalShares * amount / rMax  (same factor as reserve growth).
        sharesMinted = Math.mulDiv(p.totalShares, amount, rMax);
        if (sharesMinted < minSharesOut) revert SlippageExceeded();
        if (sharesMinted == 0) revert InsufficientLiquidity();

        p.totalShares += sharesMinted;
        sharesOf[marketId][msg.sender] += sharesMinted;

        emit FundingAdded(marketId, msg.sender, amount, sharesMinted, reservesAfter);
    }

    /* ---------- LP: removeFunding ---------- */

    /// @notice Burn shares for a proportional slice of every outcome reserve plus
    ///         a slice of accumulated TAB fees. Allowed any time, including post-resolution.
    function removeFunding(
        uint256 marketId,
        uint256 sharesIn,
        uint256[] calldata minOutcomeOut,
        uint256 minFeeOut
    ) external nonReentrant returns (uint256[] memory outcomeOut, uint256 feeOut) {
        if (sharesIn == 0) revert ZeroAmount();

        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);

        uint8 N = p.outcomeSlotCount;
        if (minOutcomeOut.length != N) revert MinOutLengthMismatch();

        uint256 ownShares = sharesOf[marketId][msg.sender];
        if (sharesIn > ownShares) revert InsufficientLiquidity();
        uint256 totalShares = p.totalShares;

        outcomeOut = new uint256[](N);
        for (uint256 i = 0; i < N; i++) {
            uint256 amt = Math.mulDiv(p.reserves[i], sharesIn, totalShares);
            outcomeOut[i] = amt;
            if (amt < minOutcomeOut[i]) revert SlippageExceeded();
            if (amt > 0) {
                p.reserves[i] -= amt;
                IERC20(p.wrappers[i]).safeTransfer(msg.sender, amt);
            }
        }

        feeOut = Math.mulDiv(p.feeAccumulated, sharesIn, totalShares);
        if (feeOut < minFeeOut) revert SlippageExceeded();
        if (feeOut > 0) {
            p.feeAccumulated -= feeOut;
            collateral.safeTransfer(msg.sender, feeOut);
        }

        sharesOf[marketId][msg.sender] = ownShares - sharesIn;
        p.totalShares = totalShares - sharesIn;

        emit FundingRemoved(marketId, msg.sender, sharesIn, outcomeOut, feeOut);
    }

    /* ---------- Trader: buy ---------- */

    function buy(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 investmentAmount,
        uint256 minOutcomeOut
    ) external nonReentrant returns (uint256 outcomeOut) {
        if (investmentAmount == 0) revert ZeroAmount();

        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        if (outcomeIndex >= p.outcomeSlotCount) revert BadOutcomeIndex(outcomeIndex);
        if (p.totalShares == 0) revert InsufficientLiquidity();

        IPredictionMarketV2.Market memory m = pmv2.getMarket(marketId);
        if (m.resolved || m.canceled || m.paused) revert MarketNotOpen(marketId);

        uint8 N = p.outcomeSlotCount;
        uint256 feeAmount = (investmentAmount * p.feeBps) / BPS;
        uint256 netIn = investmentAmount - feeAmount;

        outcomeOut = _calcBuyAmount(p.reserves, outcomeIndex, netIn);
        if (outcomeOut < minOutcomeOut) revert SlippageExceeded();
        if (outcomeOut == 0) revert InsufficientLiquidity();

        // Pull TAB, route fee to LP accumulator, splitAndWrap netIn into N wrappers.
        collateral.safeTransferFrom(msg.sender, address(this), investmentAmount);
        p.feeAccumulated += feeAmount;

        uint256[] memory wrapIndexSets = new uint256[](N);
        for (uint256 i = 0; i < N; i++) wrapIndexSets[i] = uint256(1) << i;
        pmv2.splitAndWrap(marketId, netIn, wrapIndexSets);

        // Update reserves: every outcome gains netIn; the bought one then loses outcomeOut.
        for (uint256 i = 0; i < N; i++) p.reserves[i] += netIn;
        p.reserves[outcomeIndex] -= outcomeOut;

        // Send the bought wrapper to trader.
        IERC20(p.wrappers[outcomeIndex]).safeTransfer(msg.sender, outcomeOut);

        emit Bought(marketId, msg.sender, outcomeIndex, investmentAmount, feeAmount, outcomeOut);
    }

    /* ---------- Trader: sell ---------- */

    function sell(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 returnAmount,
        uint256 maxOutcomeIn
    ) external nonReentrant returns (uint256 outcomeIn) {
        if (returnAmount == 0) revert ZeroAmount();

        Pool storage p = _pools[marketId];
        if (!p.exists) revert PoolMissing(marketId);
        if (outcomeIndex >= p.outcomeSlotCount) revert BadOutcomeIndex(outcomeIndex);
        if (p.totalShares == 0) revert InsufficientLiquidity();

        IPredictionMarketV2.Market memory m = pmv2.getMarket(marketId);
        if (m.resolved || m.canceled || m.paused) revert MarketNotOpen(marketId);

        uint8 N = p.outcomeSlotCount;

        // grossOut = returnAmount / (1 - feeBps/BPS), rounded UP — fee stays in pool.
        uint256 grossOut = Math.mulDiv(returnAmount, BPS, BPS - p.feeBps, Math.Rounding.Ceil);
        uint256 feeAmount = grossOut - returnAmount;

        // Required reserve floor: every other reserve must be > grossOut.
        for (uint256 j = 0; j < N; j++) {
            if (j == outcomeIndex) continue;
            if (p.reserves[j] <= grossOut) revert InsufficientLiquidity();
        }

        outcomeIn = _calcSellOutcomeIn(p.reserves, outcomeIndex, grossOut);
        if (outcomeIn > maxOutcomeIn) revert SlippageExceeded();
        if (outcomeIn == 0) revert InsufficientLiquidity();

        // Pull seller's wrapper, then unwrap grossOut from each outcome's holdings.
        IERC20(p.wrappers[outcomeIndex]).safeTransferFrom(msg.sender, address(this), outcomeIn);
        for (uint256 i = 0; i < N; i++) {
            IPositionWrapperUnwrap(p.wrappers[i]).unwrap(grossOut);
        }

        // Merge the full singleton partition back to TAB.
        _ensureCtApproval();
        uint256[] memory partition = new uint256[](N);
        for (uint256 i = 0; i < N; i++) partition[i] = uint256(1) << i;
        pmv2.mergeFrom(marketId, partition, grossOut);

        // Update reserves and pay seller; fee stays accrued for LPs.
        p.reserves[outcomeIndex] = p.reserves[outcomeIndex] + outcomeIn - grossOut;
        for (uint256 j = 0; j < N; j++) {
            if (j == outcomeIndex) continue;
            p.reserves[j] -= grossOut;
        }
        p.feeAccumulated += feeAmount;

        collateral.safeTransfer(msg.sender, returnAmount);

        emit Sold(marketId, msg.sender, outcomeIndex, returnAmount, feeAmount, outcomeIn);
    }

    /* ---------- internals: math ---------- */

    /// @dev outcomeOut = (R_i + netIn) - R_i * Π_{j≠i} R_j / (R_j + netIn).
    ///      Iterative form keeps intermediates bounded; ceiling rounding favors pool.
    function _calcBuyAmount(
        uint256[] memory reserves,
        uint8 outcomeIndex,
        uint256 netIn
    ) internal pure returns (uint256) {
        uint256 N = reserves.length;
        uint256 endingBalance = reserves[outcomeIndex];
        for (uint256 j = 0; j < N; j++) {
            if (j == outcomeIndex) continue;
            uint256 rj = reserves[j];
            // ratio = R_j / (R_j + netIn), so endingBalance shrinks each step.
            // Rounding ceil on endingBalance → smaller outcomeOut → favors pool.
            endingBalance = Math.mulDiv(endingBalance, rj, rj + netIn, Math.Rounding.Ceil);
        }
        uint256 plus = reserves[outcomeIndex] + netIn;
        if (endingBalance >= plus) return 0;
        return plus - endingBalance;
    }

    /// @dev outcomeIn = R_i * Π_{j≠i} R_j / (R_j - grossOut) - R_i + grossOut.
    ///      Caller must ensure R_j > grossOut for all j ≠ i.
    function _calcSellOutcomeIn(
        uint256[] memory reserves,
        uint8 outcomeIndex,
        uint256 grossOut
    ) internal pure returns (uint256) {
        uint256 N = reserves.length;
        uint256 endingBalance = reserves[outcomeIndex];
        for (uint256 j = 0; j < N; j++) {
            if (j == outcomeIndex) continue;
            uint256 rj = reserves[j];
            // ratio = R_j / (R_j - grossOut) > 1, endingBalance grows.
            // Ceil rounds up → larger outcomeIn → favors pool.
            endingBalance = Math.mulDiv(endingBalance, rj, rj - grossOut, Math.Rounding.Ceil);
        }
        // outcomeIn = endingBalance - reserves[outcomeIndex] + grossOut
        return endingBalance - reserves[outcomeIndex] + grossOut;
    }

    /* ---------- internals: approvals ---------- */

    /// @dev PMv2.mergeFrom pulls our ERC-1155 — set approval lazily once.
    function _ensureCtApproval() internal {
        if (!ctApprovalSetForPmv2) {
            IERC1155(ct).setApprovalForAll(address(pmv2), true);
            ctApprovalSetForPmv2 = true;
        }
    }
}
