// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

interface IConditionalTokens {
    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external returns (bytes32 conditionId);
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external;
    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external pure returns (bytes32);
    function getCollectionId(bytes32 conditionId, uint256 indexSet) external pure returns (bytes32);
    function getPositionId(IERC20 collateralToken, bytes32 collectionId) external pure returns (uint256);
    function splitPosition(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;
    function mergePositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external;
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;
}

interface IPositionWrapperFactory {
    function getOrCreateWrapper(
        address collateral,
        bytes32 conditionId,
        uint256 indexSet
    ) external returns (address);
}

interface IPositionWrapper {
    function wrap(uint256 amount) external;
}

/// @title PredictionMarketV2
/// @notice Lifecycle + curation + bond layer nad ConditionalTokens.
///         PM je v CT registrovaný jako oracle pro každý market — interní auth je per-market `oracle`.
///         Uživatelé volají splitTo/mergeFrom/claimWinnings na PMv2 (ne přímo na CT) —
///         tím se udržuje per-market `lockedCollateral` counter.
contract PredictionMarketV2 is ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;

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

    struct CreateMarketParams {
        string name;
        string description;
        string category;
        OutcomeType outcomeType;
        uint256 outcomeSlotCount;
        string[] outcomeLabels;
        address oracle;
        uint256 expiresAt;
        uint256 resolutionTime;
    }

    IERC20 public immutable collateral;
    IConditionalTokens public immutable ct;

    address public curator;
    address public governance;
    address public treasury;
    address public wrapperFactory;
    uint256 public defaultBond;
    uint256 public creatorCancelWindow;

    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        bytes32 indexed conditionId,
        OutcomeType outcomeType,
        uint256 outcomeSlotCount,
        uint256 expiresAt,
        uint256 bondAmount
    );
    event MarketCanceled(uint256 indexed marketId, address indexed by, bool bondSlashed);
    event MarketExtended(uint256 indexed marketId, uint256 newExpiresAt, uint256 newResolutionTime);
    event MarketPaused(uint256 indexed marketId);
    event MarketResumed(uint256 indexed marketId);
    event MarketVerified(uint256 indexed marketId, bool isVerified);
    event MarketResolved(uint256 indexed marketId, uint256[] payouts);
    event BondClaimed(uint256 indexed marketId, address indexed creator, uint256 amount);
    event BondSlashed(uint256 indexed marketId, uint256 amount);
    event GovernanceTransferred(address indexed previous, address indexed next);
    event CuratorTransferred(address indexed previous, address indexed next);
    event TreasuryTransferred(address indexed previous, address indexed next);
    event ParamsUpdated(uint256 defaultBond, uint256 creatorCancelWindow);
    event WrapperFactoryUpdated(address indexed previous, address indexed next);
    event Split(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lockedAfter);
    event Merge(uint256 indexed marketId, address indexed user, uint256 amount, uint256 lockedAfter);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 payout, uint256 lockedAfter);

    error ZeroAddress();
    error NotCurator();
    error NotGovernance();
    error NotCreator();
    error NotOracle();
    error NotAuthorized();
    error MarketNotFound(uint256 marketId);
    error MarketBadState();
    error MarketAlreadyPaused();
    error MarketNotPaused();
    error MarketIsCanceled();
    error MarketNotResolved();
    error CreatorWindowExpired(uint256 deadline, uint256 currentTime);
    error MustExtendForward();
    error ExpiresInPast();
    error ResolutionBeforeExpiry();
    error BadOutcomeShape(OutcomeType outcomeType, uint256 slots);
    error BondUnavailable();
    error NoBond();
    error BadPayoutsLength(uint256 expected, uint256 got);
    error EmptyName();
    error OutcomeLabelsLengthMismatch(uint256 expected, uint256 got);
    error EmptyOutcomeLabel(uint256 index);
    error WrapperFactoryNotSet();
    error WrapIndexSetNotInPartition(uint256 indexSet);

    modifier onlyCurator() {
        if (msg.sender != curator) revert NotCurator();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(
        IERC20 _collateral,
        IConditionalTokens _ct,
        address _curator,
        address _governance,
        address _treasury,
        uint256 _defaultBond,
        uint256 _creatorCancelWindow
    ) {
        if (address(_collateral) == address(0)) revert ZeroAddress();
        if (address(_ct) == address(0)) revert ZeroAddress();
        if (_curator == address(0)) revert ZeroAddress();
        if (_governance == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        collateral = _collateral;
        ct = _ct;
        curator = _curator;
        governance = _governance;
        treasury = _treasury;
        defaultBond = _defaultBond;
        creatorCancelWindow = _creatorCancelWindow;

        // Perpetual approval for CT to pull collateral when PMv2 calls splitPosition.
        _collateral.forceApprove(address(_ct), type(uint256).max);
    }

    /* -------- Lifecycle -------- */

    function createMarket(CreateMarketParams calldata p) external nonReentrant returns (uint256 marketId) {
        if (p.oracle == address(0)) revert ZeroAddress();
        if (p.expiresAt <= block.timestamp) revert ExpiresInPast();
        if (p.resolutionTime < p.expiresAt) revert ResolutionBeforeExpiry();
        if (bytes(p.name).length == 0) revert EmptyName();
        if (p.outcomeLabels.length != p.outcomeSlotCount) {
            revert OutcomeLabelsLengthMismatch(p.outcomeSlotCount, p.outcomeLabels.length);
        }
        for (uint256 i = 0; i < p.outcomeLabels.length; i++) {
            if (bytes(p.outcomeLabels[i]).length == 0) revert EmptyOutcomeLabel(i);
        }
        _validateOutcomeShape(p.outcomeType, p.outcomeSlotCount);

        uint256 bond = defaultBond;
        if (bond > 0) {
            collateral.safeTransferFrom(msg.sender, address(this), bond);
        }

        marketId = marketCount++;
        bytes32 questionId = keccak256(abi.encodePacked(address(this), marketId, msg.sender, block.timestamp));
        bytes32 conditionId = ct.prepareCondition(address(this), questionId, p.outcomeSlotCount);

        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.oracle = p.oracle;
        m.questionId = questionId;
        m.conditionId = conditionId;
        m.outcomeSlotCount = p.outcomeSlotCount;
        m.outcomeType = p.outcomeType;
        m.name = p.name;
        m.description = p.description;
        m.category = p.category;
        for (uint256 i = 0; i < p.outcomeLabels.length; i++) {
            m.outcomeLabels.push(p.outcomeLabels[i]);
        }
        m.createdAt = block.timestamp;
        m.expiresAt = p.expiresAt;
        m.resolutionTime = p.resolutionTime;
        m.bondAmount = bond;

        emit MarketCreated(marketId, msg.sender, conditionId, p.outcomeType, p.outcomeSlotCount, p.expiresAt, bond);
    }

    /// @notice Cancel = uniform payout (kolaterál se vrátí držitelům přes redeemPositions na CT).
    ///         Tvůrce může zrušit jen v `creatorCancelWindow` po vytvoření.
    ///         Curator může kdykoli před resolution; bond se slashne do treasury.
    function cancelMarket(uint256 marketId) external nonReentrant {
        Market storage m = _existing(marketId);
        if (m.resolved || m.canceled) revert MarketBadState();

        bool isCreator = (msg.sender == m.creator);
        bool isCurator = (msg.sender == curator);
        if (!isCreator && !isCurator) revert NotAuthorized();

        bool slash;
        if (isCurator) {
            slash = true;
            if (m.bondAmount > 0 && !m.bondSlashed && !m.bondClaimed) {
                m.bondSlashed = true;
                collateral.safeTransfer(treasury, m.bondAmount);
                emit BondSlashed(marketId, m.bondAmount);
            }
        } else {
            uint256 deadline = m.createdAt + creatorCancelWindow;
            if (block.timestamp > deadline) revert CreatorWindowExpired(deadline, block.timestamp);
        }

        m.canceled = true;
        m.resolved = true;

        uint256 N = m.outcomeSlotCount;
        uint256[] memory payouts = new uint256[](N);
        for (uint256 i = 0; i < N; i++) payouts[i] = 1;
        ct.reportPayouts(m.questionId, payouts);

        emit MarketCanceled(marketId, msg.sender, slash);
    }

    /// @notice Posune expiraci/resolution. Pouze tvůrce nebo curator. Jen vpřed.
    function extendMarket(uint256 marketId, uint256 newExpiresAt, uint256 newResolutionTime) external {
        Market storage m = _existing(marketId);
        if (m.resolved || m.canceled) revert MarketBadState();
        if (msg.sender != m.creator && msg.sender != curator) revert NotAuthorized();
        if (newExpiresAt < m.expiresAt) revert MustExtendForward();
        if (newResolutionTime < newExpiresAt) revert ResolutionBeforeExpiry();
        m.expiresAt = newExpiresAt;
        m.resolutionTime = newResolutionTime;
        emit MarketExtended(marketId, newExpiresAt, newResolutionTime);
    }

    function pauseMarket(uint256 marketId) external onlyGovernance {
        Market storage m = _existing(marketId);
        if (m.resolved || m.canceled) revert MarketBadState();
        if (m.paused) revert MarketAlreadyPaused();
        m.paused = true;
        emit MarketPaused(marketId);
    }

    function resumeMarket(uint256 marketId) external onlyGovernance {
        Market storage m = _existing(marketId);
        if (!m.paused) revert MarketNotPaused();
        m.paused = false;
        emit MarketResumed(marketId);
    }

    /* -------- Curation -------- */

    function verifyMarket(uint256 marketId, bool isVerified) external onlyCurator {
        Market storage m = _existing(marketId);
        if (m.canceled) revert MarketIsCanceled();
        m.verified = isVerified;
        emit MarketVerified(marketId, isVerified);
    }

    /// @notice Slash bondu bez cancel — pro post-hoc penalizaci spam/invalid trhů.
    function slashCreatorBond(uint256 marketId) external onlyCurator nonReentrant {
        Market storage m = _existing(marketId);
        if (m.bondSlashed || m.bondClaimed) revert BondUnavailable();
        if (m.bondAmount == 0) revert NoBond();
        m.bondSlashed = true;
        collateral.safeTransfer(treasury, m.bondAmount);
        emit BondSlashed(marketId, m.bondAmount);
    }

    function claimCreatorBond(uint256 marketId) external nonReentrant {
        Market storage m = _existing(marketId);
        if (msg.sender != m.creator) revert NotCreator();
        if (!m.resolved) revert MarketNotResolved();
        if (m.bondSlashed || m.bondClaimed) revert BondUnavailable();
        m.bondClaimed = true;
        if (m.bondAmount > 0) {
            collateral.safeTransfer(m.creator, m.bondAmount);
        }
        emit BondClaimed(marketId, m.creator, m.bondAmount);
    }

    /* -------- Resolution -------- */

    /// @notice Per-market designovaný oracle reportuje payout vector. Žádné omezení na hodnoty
    ///         (binární, multi i scalar řešeny stejnou cestou).
    function resolveMarket(uint256 marketId, uint256[] calldata payouts) external nonReentrant {
        Market storage m = _existing(marketId);
        if (msg.sender != m.oracle && msg.sender != m.creator) revert NotOracle();
        if (m.resolved || m.canceled) revert MarketBadState();
        if (m.paused) revert MarketAlreadyPaused();
        if (payouts.length != m.outcomeSlotCount) revert BadPayoutsLength(m.outcomeSlotCount, payouts.length);

        m.resolved = true;
        ct.reportPayouts(m.questionId, payouts);
        emit MarketResolved(marketId, payouts);
    }

    /* -------- User collateral lifecycle (wraps CT) -------- */

    /// @notice Pulls `amount` TAB from caller, splits into the partition on CT, sends ERC-1155 positions back.
    ///         Increments `lockedCollateral` for the market. Use this instead of CT.splitPosition directly.
    function splitTo(
        uint256 marketId,
        uint256[] calldata partition,
        uint256 amount
    ) external nonReentrant {
        Market storage m = _existing(marketId);
        if (m.canceled) revert MarketIsCanceled();
        if (m.paused) revert MarketAlreadyPaused();

        collateral.safeTransferFrom(msg.sender, address(this), amount);
        ct.splitPosition(collateral, m.conditionId, partition, amount);
        m.lockedCollateral += amount;

        (uint256[] memory ids, uint256[] memory amts) = _positionsForPartition(m.conditionId, partition, amount);
        IERC1155(address(ct)).safeBatchTransferFrom(address(this), msg.sender, ids, amts, "");

        emit Split(marketId, msg.sender, amount, m.lockedCollateral);
    }

    /// @notice Pulls user's ERC-1155 positions for the partition, merges on CT, returns TAB.
    ///         Decrements `lockedCollateral`. User must `ct.setApprovalForAll(PMv2, true)` first.
    function mergeFrom(
        uint256 marketId,
        uint256[] calldata partition,
        uint256 amount
    ) external nonReentrant {
        Market storage m = _existing(marketId);

        (uint256[] memory ids, uint256[] memory amts) = _positionsForPartition(m.conditionId, partition, amount);
        IERC1155(address(ct)).safeBatchTransferFrom(msg.sender, address(this), ids, amts, "");

        ct.mergePositions(collateral, m.conditionId, partition, amount);
        m.lockedCollateral -= amount;

        collateral.safeTransfer(msg.sender, amount);
        emit Merge(marketId, msg.sender, amount, m.lockedCollateral);
    }

    /// @notice Atomic split (one position per outcome) + wrap of selected indexSets into ERC-20.
    ///         Non-wrapped outcomes go to the user as ERC-1155.
    ///         `wrapIndexSets` must be a subset of the atomic singleton partition (1, 2, 4, ...).
    function splitAndWrap(
        uint256 marketId,
        uint256 amount,
        uint256[] calldata wrapIndexSets
    ) external nonReentrant {
        if (wrapperFactory == address(0)) revert WrapperFactoryNotSet();

        Market storage m = _existing(marketId);
        if (m.canceled) revert MarketIsCanceled();
        if (m.paused) revert MarketAlreadyPaused();

        uint256 N = m.outcomeSlotCount;
        uint256[] memory partition = new uint256[](N);
        for (uint256 i = 0; i < N; i++) partition[i] = uint256(1) << i;

        collateral.safeTransferFrom(msg.sender, address(this), amount);
        ct.splitPosition(collateral, m.conditionId, partition, amount);
        m.lockedCollateral += amount;

        // Wrap selected indexSets, send ERC-20 to user.
        for (uint256 j = 0; j < wrapIndexSets.length; j++) {
            uint256 indexSet = wrapIndexSets[j];
            if (indexSet == 0 || (indexSet & (indexSet - 1)) != 0 || indexSet >= (uint256(1) << N)) {
                revert WrapIndexSetNotInPartition(indexSet);
            }

            address wrapper = IPositionWrapperFactory(wrapperFactory).getOrCreateWrapper(
                address(collateral),
                m.conditionId,
                indexSet
            );
            // Allow wrapper to pull our ERC-1155 of any positionId (idempotent).
            if (!IERC1155(address(ct)).isApprovedForAll(address(this), wrapper)) {
                IERC1155(address(ct)).setApprovalForAll(wrapper, true);
            }
            IPositionWrapper(wrapper).wrap(amount);
            IERC20(wrapper).safeTransfer(msg.sender, amount);
        }

        // Send remaining (non-wrapped) ERC-1155 positions to user.
        uint256 remaining = N - wrapIndexSets.length;
        if (remaining > 0) {
            uint256[] memory ids = new uint256[](remaining);
            uint256[] memory amts = new uint256[](remaining);
            uint256 k;
            for (uint256 i = 0; i < N; i++) {
                uint256 indexSet = uint256(1) << i;
                bool wrapped;
                for (uint256 j = 0; j < wrapIndexSets.length; j++) {
                    if (wrapIndexSets[j] == indexSet) {
                        wrapped = true;
                        break;
                    }
                }
                if (!wrapped) {
                    bytes32 collectionId = ct.getCollectionId(m.conditionId, indexSet);
                    ids[k] = ct.getPositionId(collateral, collectionId);
                    amts[k] = amount;
                    k++;
                }
            }
            IERC1155(address(ct)).safeBatchTransferFrom(address(this), msg.sender, ids, amts, "");
        }

        emit Split(marketId, msg.sender, amount, m.lockedCollateral);
    }

    /// @notice Pulls user's winning ERC-1155 positions, redeems on CT, returns TAB payout.
    ///         User must `ct.setApprovalForAll(PMv2, true)` first.
    function claimWinnings(uint256 marketId, uint256[] calldata indexSets) external nonReentrant {
        Market storage m = _existing(marketId);
        if (!m.resolved) revert MarketNotResolved();

        uint256 K = indexSets.length;
        uint256[] memory ids = new uint256[](K);
        uint256[] memory amts = new uint256[](K);
        for (uint256 j = 0; j < K; j++) {
            bytes32 collectionId = ct.getCollectionId(m.conditionId, indexSets[j]);
            ids[j] = ct.getPositionId(collateral, collectionId);
            amts[j] = IERC1155(address(ct)).balanceOf(msg.sender, ids[j]);
        }
        IERC1155(address(ct)).safeBatchTransferFrom(msg.sender, address(this), ids, amts, "");

        uint256 balanceBefore = collateral.balanceOf(address(this));
        ct.redeemPositions(collateral, m.conditionId, indexSets);
        uint256 payout = collateral.balanceOf(address(this)) - balanceBefore;

        if (payout > 0) {
            // payout je always <= lockedCollateral; underflow nemůže nastat
            m.lockedCollateral -= payout;
            collateral.safeTransfer(msg.sender, payout);
        }
        emit Claimed(marketId, msg.sender, payout, m.lockedCollateral);
    }

    /* -------- Governance setters -------- */

    function setWrapperFactory(address next) external onlyGovernance {
        if (next == address(0)) revert ZeroAddress();
        emit WrapperFactoryUpdated(wrapperFactory, next);
        wrapperFactory = next;
    }

    function transferCurator(address next) external onlyGovernance {
        if (next == address(0)) revert ZeroAddress();
        emit CuratorTransferred(curator, next);
        curator = next;
    }

    function transferGovernance(address next) external onlyGovernance {
        if (next == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, next);
        governance = next;
    }

    function transferTreasury(address next) external onlyGovernance {
        if (next == address(0)) revert ZeroAddress();
        emit TreasuryTransferred(treasury, next);
        treasury = next;
    }

    function setParams(uint256 _defaultBond, uint256 _creatorCancelWindow) external onlyGovernance {
        defaultBond = _defaultBond;
        creatorCancelWindow = _creatorCancelWindow;
        emit ParamsUpdated(_defaultBond, _creatorCancelWindow);
    }

    /* -------- Views -------- */

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _existing(marketId);
    }

    function conditionIdOf(uint256 marketId) external view returns (bytes32) {
        return _existing(marketId).conditionId;
    }

    /* -------- Internals -------- */

    function _existing(uint256 marketId) internal view returns (Market storage m) {
        if (marketId >= marketCount) revert MarketNotFound(marketId);
        m = markets[marketId];
    }

    function _positionsForPartition(
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) internal view returns (uint256[] memory ids, uint256[] memory amounts) {
        uint256 K = partition.length;
        ids = new uint256[](K);
        amounts = new uint256[](K);
        for (uint256 i = 0; i < K; i++) {
            bytes32 collectionId = ct.getCollectionId(conditionId, partition[i]);
            ids[i] = ct.getPositionId(collateral, collectionId);
            amounts[i] = amount;
        }
    }

    function _validateOutcomeShape(OutcomeType t, uint256 slots) internal pure {
        if (t == OutcomeType.BINARY) {
            if (slots != 2) revert BadOutcomeShape(t, slots);
        } else if (t == OutcomeType.SCALAR) {
            if (slots != 2) revert BadOutcomeShape(t, slots);
        } else {
            // MULTI
            if (slots < 3) revert BadOutcomeShape(t, slots);
        }
    }
}
