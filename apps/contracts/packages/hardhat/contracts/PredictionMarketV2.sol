// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
}

/// @title PredictionMarketV2
/// @notice Lifecycle + curation + bond layer nad ConditionalTokens.
///         PM je v CT registrovaný jako oracle pro každý market — interní auth je per-market `oracle`.
///         Uživatelé volají splitPosition/mergePositions/redeemPositions přímo na CT.
contract PredictionMarketV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum OutcomeType {
        BINARY,
        MULTI,
        SCALAR,
        ORDINAL
    }

    struct Market {
        address creator;
        address oracle;
        bytes32 questionId;
        bytes32 conditionId;
        uint256 outcomeSlotCount;
        OutcomeType outcomeType;
        string description;
        string category;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 resolutionTime;
        uint256 bondAmount;
        bool bondClaimed;
        bool bondSlashed;
        bool verified;
        bool canceled;
        bool resolved;
        bool paused;
    }

    IERC20 public immutable collateral;
    IConditionalTokens public immutable ct;

    address public curator;
    address public governance;
    address public treasury;
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

    modifier onlyCurator() {
        require(msg.sender == curator, "not curator");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "not governance");
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
        require(address(_collateral) != address(0), "collateral=zero");
        require(address(_ct) != address(0), "ct=zero");
        require(_curator != address(0), "curator=zero");
        require(_governance != address(0), "governance=zero");
        require(_treasury != address(0), "treasury=zero");

        collateral = _collateral;
        ct = _ct;
        curator = _curator;
        governance = _governance;
        treasury = _treasury;
        defaultBond = _defaultBond;
        creatorCancelWindow = _creatorCancelWindow;
    }

    /* -------- Lifecycle -------- */

    function createMarket(
        string calldata description,
        string calldata category,
        OutcomeType outcomeType,
        uint256 outcomeSlotCount,
        address oracle,
        uint256 expiresAt,
        uint256 resolutionTime
    ) external nonReentrant returns (uint256 marketId) {
        require(oracle != address(0), "oracle=zero");
        require(expiresAt > block.timestamp, "expiresAt past");
        require(resolutionTime >= expiresAt, "resolution before expires");
        _validateOutcomeShape(outcomeType, outcomeSlotCount);

        uint256 bond = defaultBond;
        if (bond > 0) {
            collateral.safeTransferFrom(msg.sender, address(this), bond);
        }

        marketId = marketCount++;
        bytes32 questionId = keccak256(abi.encodePacked(address(this), marketId, msg.sender, block.timestamp));
        bytes32 conditionId = ct.prepareCondition(address(this), questionId, outcomeSlotCount);

        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.oracle = oracle;
        m.questionId = questionId;
        m.conditionId = conditionId;
        m.outcomeSlotCount = outcomeSlotCount;
        m.outcomeType = outcomeType;
        m.description = description;
        m.category = category;
        m.createdAt = block.timestamp;
        m.expiresAt = expiresAt;
        m.resolutionTime = resolutionTime;
        m.bondAmount = bond;

        emit MarketCreated(marketId, msg.sender, conditionId, outcomeType, outcomeSlotCount, expiresAt, bond);
    }

    /// @notice Cancel = uniform payout (kolaterál se vrátí držitelům přes redeemPositions na CT).
    ///         Tvůrce může zrušit jen v `creatorCancelWindow` po vytvoření.
    ///         Curator může kdykoli před resolution; bond se slashne do treasury.
    function cancelMarket(uint256 marketId) external nonReentrant {
        Market storage m = _existing(marketId);
        require(!m.resolved && !m.canceled, "bad state");

        bool isCreator = (msg.sender == m.creator);
        bool isCurator = (msg.sender == curator);
        require(isCreator || isCurator, "not auth");

        bool slash;
        if (isCurator) {
            slash = true;
            if (m.bondAmount > 0 && !m.bondSlashed && !m.bondClaimed) {
                m.bondSlashed = true;
                collateral.safeTransfer(treasury, m.bondAmount);
                emit BondSlashed(marketId, m.bondAmount);
            }
        } else {
            require(block.timestamp <= m.createdAt + creatorCancelWindow, "creator window expired");
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
        require(!m.resolved && !m.canceled, "bad state");
        require(msg.sender == m.creator || msg.sender == curator, "not auth");
        require(newExpiresAt >= m.expiresAt, "must extend forward");
        require(newResolutionTime >= newExpiresAt, "resolution before expires");
        m.expiresAt = newExpiresAt;
        m.resolutionTime = newResolutionTime;
        emit MarketExtended(marketId, newExpiresAt, newResolutionTime);
    }

    function pauseMarket(uint256 marketId) external onlyGovernance {
        Market storage m = _existing(marketId);
        require(!m.resolved && !m.canceled, "bad state");
        require(!m.paused, "already paused");
        m.paused = true;
        emit MarketPaused(marketId);
    }

    function resumeMarket(uint256 marketId) external onlyGovernance {
        Market storage m = _existing(marketId);
        require(m.paused, "not paused");
        m.paused = false;
        emit MarketResumed(marketId);
    }

    /* -------- Curation -------- */

    function verifyMarket(uint256 marketId, bool isVerified) external onlyCurator {
        Market storage m = _existing(marketId);
        require(!m.canceled, "canceled");
        m.verified = isVerified;
        emit MarketVerified(marketId, isVerified);
    }

    /// @notice Slash bondu bez cancel — pro post-hoc penalizaci spam/invalid trhů.
    function slashCreatorBond(uint256 marketId) external onlyCurator nonReentrant {
        Market storage m = _existing(marketId);
        require(!m.bondSlashed && !m.bondClaimed, "bond unavailable");
        require(m.bondAmount > 0, "no bond");
        m.bondSlashed = true;
        collateral.safeTransfer(treasury, m.bondAmount);
        emit BondSlashed(marketId, m.bondAmount);
    }

    function claimCreatorBond(uint256 marketId) external nonReentrant {
        Market storage m = _existing(marketId);
        require(msg.sender == m.creator, "not creator");
        require(m.resolved, "not resolved");
        require(!m.bondSlashed && !m.bondClaimed, "bond unavailable");
        m.bondClaimed = true;
        if (m.bondAmount > 0) {
            collateral.safeTransfer(m.creator, m.bondAmount);
        }
        emit BondClaimed(marketId, m.creator, m.bondAmount);
    }

    /* -------- Resolution -------- */

    /// @notice Per-market designovaný oracle reportuje payout vector. Žádné omezení na hodnoty
    ///         (binární, multi, scalar i ordinal řešeny stejnou cestou).
    function resolveMarket(uint256 marketId, uint256[] calldata payouts) external nonReentrant {
        Market storage m = _existing(marketId);
        require(msg.sender == m.oracle, "not oracle");
        require(!m.resolved && !m.canceled, "bad state");
        require(!m.paused, "paused");
        require(payouts.length == m.outcomeSlotCount, "bad payouts length");

        m.resolved = true;
        ct.reportPayouts(m.questionId, payouts);
        emit MarketResolved(marketId, payouts);
    }

    /* -------- Governance setters -------- */

    function transferCurator(address next) external onlyGovernance {
        require(next != address(0), "zero");
        emit CuratorTransferred(curator, next);
        curator = next;
    }

    function transferGovernance(address next) external onlyGovernance {
        require(next != address(0), "zero");
        emit GovernanceTransferred(governance, next);
        governance = next;
    }

    function transferTreasury(address next) external onlyGovernance {
        require(next != address(0), "zero");
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

    /* -------- Internals -------- */

    function _existing(uint256 marketId) internal view returns (Market storage m) {
        require(marketId < marketCount, "market not found");
        m = markets[marketId];
    }

    function _validateOutcomeShape(OutcomeType t, uint256 slots) internal pure {
        if (t == OutcomeType.BINARY) {
            require(slots == 2, "BINARY needs 2 slots");
        } else if (t == OutcomeType.SCALAR) {
            require(slots == 2, "SCALAR needs 2 slots (LOW/HIGH)");
        } else if (t == OutcomeType.MULTI) {
            require(slots >= 3, "MULTI needs >= 3 slots");
        } else {
            require(slots >= 2, "ORDINAL needs >= 2 slots");
        }
    }
}
