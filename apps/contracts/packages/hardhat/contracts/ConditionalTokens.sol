// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ConditionalTokens — vlastní lehká implementace Gnosis CTF
/// @notice ERC-1155 conditional positions. Bez nested conditions (parent collection vždy = 0).
///         Full set N tokenů (jeden za každý outcome slot) = 1 jednotka kolaterálu.
contract ConditionalTokens is ERC1155, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Condition {
        address oracle;
        bytes32 questionId;
        uint256 outcomeSlotCount;
        uint256 payoutDenominator;
        uint256[] payoutNumerators;
        bool resolved;
    }

    mapping(bytes32 => Condition) private _conditions;

    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed conditionId,
        uint256[] indexSets,
        uint256 payout
    );

    error ZeroAddress();
    error BadSlotCount(uint256 outcomeSlotCount);
    error AlreadyPrepared();
    error PayoutsTooShort(uint256 length);
    error ConditionNotPrepared();
    error AlreadyResolved();
    error ZeroDenominator();
    error ZeroAmount();
    error BadIndexSet(uint256 indexSet);
    error PartitionTooShort(uint256 length);
    error PartitionOverlap();
    error IncompletePartition();
    error NotResolved();

    constructor() ERC1155("") {}

    /* ----- ID helpers ----- */

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getCollectionId(bytes32 conditionId, uint256 indexSet) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(conditionId, indexSet));
    }

    function getPositionId(IERC20 collateralToken, bytes32 collectionId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(address(collateralToken), collectionId)));
    }

    /* ----- Reads ----- */

    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256) {
        return _conditions[conditionId].outcomeSlotCount;
    }

    function payoutDenominator(bytes32 conditionId) external view returns (uint256) {
        return _conditions[conditionId].payoutDenominator;
    }

    function payoutNumerators(bytes32 conditionId, uint256 i) external view returns (uint256) {
        return _conditions[conditionId].payoutNumerators[i];
    }

    function isResolved(bytes32 conditionId) external view returns (bool) {
        return _conditions[conditionId].resolved;
    }

    function conditionOracle(bytes32 conditionId) external view returns (address) {
        return _conditions[conditionId].oracle;
    }

    /* ----- Lifecycle ----- */

    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external returns (bytes32 conditionId) {
        if (oracle == address(0)) revert ZeroAddress();
        if (outcomeSlotCount < 2 || outcomeSlotCount > 256) revert BadSlotCount(outcomeSlotCount);
        conditionId = getConditionId(oracle, questionId, outcomeSlotCount);

        Condition storage c = _conditions[conditionId];
        if (c.outcomeSlotCount != 0) revert AlreadyPrepared();

        c.oracle = oracle;
        c.questionId = questionId;
        c.outcomeSlotCount = outcomeSlotCount;
        c.payoutNumerators = new uint256[](outcomeSlotCount);

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    /// @notice Oracle reportuje payout vector. Žádné omezení na hodnoty (kromě sumy > 0).
    ///         Denominator = sum(payouts). Pro ordinální resolution stačí oraclu rozdělit váhu.
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external {
        uint256 N = payouts.length;
        if (N < 2) revert PayoutsTooShort(N);

        bytes32 conditionId = getConditionId(msg.sender, questionId, N);
        Condition storage c = _conditions[conditionId];

        if (c.outcomeSlotCount != N) revert ConditionNotPrepared();
        if (c.resolved) revert AlreadyResolved();

        uint256 denom;
        for (uint256 i = 0; i < N; i++) {
            uint256 p = payouts[i];
            denom += p;
            c.payoutNumerators[i] = p;
        }
        if (denom == 0) revert ZeroDenominator();
        c.payoutDenominator = denom;
        c.resolved = true;

        emit ConditionResolution(conditionId, msg.sender, questionId, N, payouts);
    }

    /* ----- Token mechanics ----- */

    /// @notice Zamkne `amount` kolaterálu, vydá `amount` tokenů pro každý indexSet z partition.
    ///         Partition musí být úplné a disjunktní pokrytí všech outcome slotů.
    function splitPosition(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external nonReentrant {
        Condition storage c = _conditions[conditionId];
        uint256 N = c.outcomeSlotCount;
        if (N == 0) revert ConditionNotPrepared();
        if (amount == 0) revert ZeroAmount();

        uint256 fullIndexSet = (N == 256) ? type(uint256).max : (uint256(1) << N) - 1;
        _validatePartition(partition, fullIndexSet);

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 K = partition.length;
        uint256[] memory ids = new uint256[](K);
        uint256[] memory amounts = new uint256[](K);
        for (uint256 i = 0; i < K; i++) {
            bytes32 collectionId = getCollectionId(conditionId, partition[i]);
            ids[i] = getPositionId(collateralToken, collectionId);
            amounts[i] = amount;
        }
        _mintBatch(msg.sender, ids, amounts, "");

        emit PositionSplit(msg.sender, collateralToken, conditionId, partition, amount);
    }

    /// @notice Spálí full partition tokenů a vrátí kolaterál. Funguje kdykoli — i po resolution.
    function mergePositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external nonReentrant {
        Condition storage c = _conditions[conditionId];
        uint256 N = c.outcomeSlotCount;
        if (N == 0) revert ConditionNotPrepared();
        if (amount == 0) revert ZeroAmount();

        uint256 fullIndexSet = (N == 256) ? type(uint256).max : (uint256(1) << N) - 1;
        _validatePartition(partition, fullIndexSet);

        uint256 K = partition.length;
        uint256[] memory ids = new uint256[](K);
        uint256[] memory amounts = new uint256[](K);
        for (uint256 i = 0; i < K; i++) {
            bytes32 collectionId = getCollectionId(conditionId, partition[i]);
            ids[i] = getPositionId(collateralToken, collectionId);
            amounts[i] = amount;
        }
        _burnBatch(msg.sender, ids, amounts);

        collateralToken.safeTransfer(msg.sender, amount);
        emit PositionsMerge(msg.sender, collateralToken, conditionId, partition, amount);
    }

    /// @notice Po resolution: spálí pozice z `indexSets` a vyplatí proporcionální payout.
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external nonReentrant {
        Condition storage c = _conditions[conditionId];
        if (!c.resolved) revert NotResolved();
        uint256 N = c.outcomeSlotCount;
        uint256 denom = c.payoutDenominator;
        uint256 fullIndexSet = (N == 256) ? type(uint256).max : (uint256(1) << N) - 1;

        uint256 totalPayout;

        for (uint256 j = 0; j < indexSets.length; j++) {
            uint256 indexSet = indexSets[j];
            if (indexSet == 0 || indexSet > fullIndexSet) revert BadIndexSet(indexSet);

            uint256 payoutNumerator;
            for (uint256 i = 0; i < N; i++) {
                if ((indexSet & (uint256(1) << i)) != 0) {
                    payoutNumerator += c.payoutNumerators[i];
                }
            }

            bytes32 collectionId = getCollectionId(conditionId, indexSet);
            uint256 positionId = getPositionId(collateralToken, collectionId);
            uint256 balance = balanceOf(msg.sender, positionId);
            if (balance == 0) continue;

            _burn(msg.sender, positionId, balance);
            if (payoutNumerator > 0) {
                totalPayout += (balance * payoutNumerator) / denom;
            }
        }

        if (totalPayout > 0) {
            collateralToken.safeTransfer(msg.sender, totalPayout);
        }

        emit PayoutRedemption(msg.sender, collateralToken, conditionId, indexSets, totalPayout);
    }

    /* ----- internals ----- */

    function _validatePartition(uint256[] calldata partition, uint256 fullIndexSet) internal pure {
        if (partition.length < 2) revert PartitionTooShort(partition.length);
        uint256 union;
        for (uint256 i = 0; i < partition.length; i++) {
            uint256 set = partition[i];
            if (set == 0 || set > fullIndexSet) revert BadIndexSet(set);
            if ((union & set) != 0) revert PartitionOverlap();
            union |= set;
        }
        if (union != fullIndexSet) revert IncompletePartition();
    }
}
