// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IPredictionAMM
/// @notice External surface of `PredictionAMM` — multi-outcome FPMM nad PredictionMarketV2.
///         Constant-product invariant Π reserves[i] = k (drift in pool's favor by design).
///         Pool drží ERC-20 wrapped outcome positions; collateral (TAB) protéká jen jako
///         input/output (a akumuluje se jako fee). Jeden pool per `marketId`.
interface IPredictionAMM {
    /* ---------- types ---------- */

    /// @dev Pole `reserves` a `wrappers` jsou délky `outcomeSlotCount` (max 16).
    struct Pool {
        bool exists;
        uint8 outcomeSlotCount;
        uint16 feeBps;
        bytes32 conditionId;
        uint256 totalShares;
        uint256 feeAccumulated;
        uint256[] reserves;
        address[] wrappers;
    }

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

    /* ---------- immutable getters ---------- */

    function collateral() external view returns (IERC20);
    function pmv2() external view returns (address);
    function wrapperFactory() external view returns (address);
    function ct() external view returns (address);

    function BPS() external view returns (uint16);
    function MAX_FEE_BPS() external view returns (uint16);
    function MAX_OUTCOMES() external view returns (uint8);

    /* ---------- state getters ---------- */

    function sharesOf(uint256 marketId, address user) external view returns (uint256);
    function ctApprovalSetForPmv2() external view returns (bool);

    /* ---------- views ---------- */

    /// @notice Plný stav poolu pro daný market.
    function getPool(uint256 marketId) external view returns (Pool memory);

    /// @notice Pole rezerv (jeden item per outcome). Cena outcome i ≈ Σ_{j≠i} R_j / Σ R_j.
    function getReserves(uint256 marketId) external view returns (uint256[] memory);

    /// @notice ERC-20 wrapper adresy, jeden per outcome (`indexSet = 1 << i`).
    function getWrappers(uint256 marketId) external view returns (address[] memory);

    /// @notice LP shares uživatele a celkové shares poolu.
    function getShares(
        uint256 marketId,
        address user
    ) external view returns (uint256 shares, uint256 totalShares);

    /// @notice Pro-rata TAB fees, které by uživatel dostal při `removeFunding(allShares)`.
    function pendingFeesOf(uint256 marketId, address user) external view returns (uint256);

    /// @notice Quote: kolik outcome[i] dostanu za `investmentAmount` TAB. Reverts při neexistujícím poolu.
    function calcBuyAmount(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 investmentAmount
    ) external view returns (uint256 outcomeOut, uint256 feeAmount);

    /// @notice Quote: kolik outcome[i] musím poslat, abych dostal `returnAmount` TAB.
    function calcSellAmount(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 returnAmount
    ) external view returns (uint256 outcomeIn, uint256 feeAmount);

    /* ---------- LP ---------- */

    /// @notice Vytvoří pool s 1:1 reservou napříč všemi outcomes (50/50/.../50 cena).
    ///         Volající musí mít předem `TAB.approve(amm, initialFunding)`.
    function createPool(
        uint256 marketId,
        uint256 initialFunding,
        uint16 feeBps
    ) external returns (uint256 sharesMinted);

    /// @notice Přidá likviditu, drží stávající cenu, zbytek wrapperu (rare side) vrátí.
    ///         `minSharesOut` = slippage protection.
    function addFunding(
        uint256 marketId,
        uint256 amount,
        uint256 minSharesOut
    ) external returns (uint256 sharesMinted);

    /// @notice Burnne shares za pro-rata podíl všech reserves + slice fee bucketu.
    ///         Povoleno i post-resolution. `minOutcomeOut.length == outcomeSlotCount`.
    function removeFunding(
        uint256 marketId,
        uint256 sharesIn,
        uint256[] calldata minOutcomeOut,
        uint256 minFeeOut
    ) external returns (uint256[] memory outcomeOut, uint256 feeOut);

    /* ---------- Trader ---------- */

    /// @notice Koupí `outcome[outcomeIndex]` za `investmentAmount` TAB. `minOutcomeOut` = slippage.
    ///         Volající musí mít předem `TAB.approve(amm, investmentAmount)`.
    function buy(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 investmentAmount,
        uint256 minOutcomeOut
    ) external returns (uint256 outcomeOut);

    /// @notice Prodá `outcome[outcomeIndex]` wrapper za `returnAmount` TAB. `maxOutcomeIn` = slippage.
    ///         Volající musí mít předem `wrapper.approve(amm, maxOutcomeIn)`.
    function sell(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 returnAmount,
        uint256 maxOutcomeIn
    ) external returns (uint256 outcomeIn);
}
