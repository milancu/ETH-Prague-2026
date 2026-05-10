// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPredictionMarket {
    function conditionIdOf(uint256 marketId) external view returns (bytes32);
}

interface IPositionWrapperFactory {
    function wrapperOf(bytes32 key) external view returns (address);
    function key(address collateral, bytes32 conditionId, uint256 indexSet) external pure returns (bytes32);
}

interface IPositionWrapperRead {
    function conditionId() external view returns (bytes32);
    function indexSet() external view returns (uint256);
    function collateral() external view returns (address);
}

/// @title TabClob — minimal EIP-712 ERC-20 limit order book with partial fills
/// @notice Maker signs an off-chain Order (EIP-712) bound to a specific market.
///         Taker calls `fill` on-chain with a desired makerAmount; the opposite
///         takerAmount is computed pro-rata (rounded up to favor the maker).
///         Order remains live until `filledMakerAmount[h] == o.makerAmount`,
///         is canceled, or expires.
/// @dev    OZ `EIP712` recomputes the domain separator when `block.chainid` differs
///         from the cached chainId, so the contract works correctly on a fork even
///         if the original chainId of the host network changes.
///         `SignatureChecker.isValidSignatureNow` handles both ECDSA EOAs and
///         EIP-1271 contract wallets (smart accounts).
contract TabClob is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        address taker; // address(0) = anyone may fill
        address makerToken;
        address takerToken;
        uint128 makerAmount;
        uint128 takerAmount;
        uint64 expiry; // unix seconds
        uint256 salt;
        uint256 marketId; // PMv2 marketId; both tokens must be TABcoin or registered wrappers of this market
    }

    bytes32 public constant ORDER_TYPEHASH =
        keccak256(
            "Order(address maker,address taker,address makerToken,address takerToken,uint128 makerAmount,uint128 takerAmount,uint64 expiry,uint256 salt,uint256 marketId)"
        );

    address public immutable collateral; // TABcoin
    address public immutable factory; // PositionWrapperFactory
    address public immutable predictionMarket; // PredictionMarketV2

    mapping(bytes32 => uint128) public filledMakerAmount;
    mapping(bytes32 => bool) public canceled;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address makerToken,
        address takerToken,
        uint128 fillMakerAmount,
        uint128 fillTakerAmount,
        uint128 cumulativeFilled
    );
    event OrderCanceled(bytes32 indexed orderHash, address indexed maker);

    error ZeroAddress();
    error AlreadyCanceled();
    error OrderExpired(uint64 expiry, uint256 currentTime);
    error WrongTaker(address expected, address actual);
    error ZeroAmount();
    error BadSignature();
    error NotMaker(address expected, address actual);
    error OverFill(uint128 remaining, uint128 requested);
    error TokenNotAllowed(address token, uint256 marketId);

    constructor(address _collateral, address _factory, address _predictionMarket) EIP712("TabClob", "1") {
        if (_collateral == address(0)) revert ZeroAddress();
        if (_factory == address(0)) revert ZeroAddress();
        if (_predictionMarket == address(0)) revert ZeroAddress();
        collateral = _collateral;
        factory = _factory;
        predictionMarket = _predictionMarket;
    }

    /// @notice EIP-712 hash of an Order in this contract's domain.
    function hashOrder(Order calldata o) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        ORDER_TYPEHASH,
                        o.maker,
                        o.taker,
                        o.makerToken,
                        o.takerToken,
                        o.makerAmount,
                        o.takerAmount,
                        o.expiry,
                        o.salt,
                        o.marketId
                    )
                )
            );
    }

    /// @notice Partial fill: taker takes `fillMakerAmount` of makerToken, pays pro-rata takerToken.
    ///         Pro-rata is rounded up on the taker payment side (favors maker on dust).
    function fill(Order calldata o, uint128 fillMakerAmount, bytes calldata signature) external nonReentrant {
        bytes32 h = hashOrder(o);
        if (canceled[h]) revert AlreadyCanceled();
        if (block.timestamp >= o.expiry) revert OrderExpired(o.expiry, block.timestamp);
        if (o.taker != address(0) && o.taker != msg.sender) revert WrongTaker(o.taker, msg.sender);
        if (o.makerAmount == 0 || o.takerAmount == 0 || fillMakerAmount == 0) revert ZeroAmount();
        if (!SignatureChecker.isValidSignatureNow(o.maker, h, signature)) revert BadSignature();

        uint128 already = filledMakerAmount[h];
        uint128 remaining = o.makerAmount - already;
        if (fillMakerAmount > remaining) revert OverFill(remaining, fillMakerAmount);

        // Validate both tokens are allowed for this market (TABcoin or registered wrapper).
        _checkTokenAllowed(o.makerToken, o.marketId);
        _checkTokenAllowed(o.takerToken, o.marketId);

        // ceilDiv(fillMakerAmount * o.takerAmount, o.makerAmount) — favor maker on rounding.
        uint256 fillTakerAmount = (uint256(fillMakerAmount) * uint256(o.takerAmount) + uint256(o.makerAmount) - 1) /
            uint256(o.makerAmount);

        uint128 newCumulative = already + fillMakerAmount;
        filledMakerAmount[h] = newCumulative;

        IERC20(o.takerToken).safeTransferFrom(msg.sender, o.maker, fillTakerAmount);
        IERC20(o.makerToken).safeTransferFrom(o.maker, msg.sender, fillMakerAmount);

        emit OrderFilled(
            h,
            o.maker,
            msg.sender,
            o.makerToken,
            o.takerToken,
            fillMakerAmount,
            uint128(fillTakerAmount),
            newCumulative
        );
    }

    /// @notice Maker invalidates the unfilled remainder of an order.
    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert NotMaker(o.maker, msg.sender);
        bytes32 h = hashOrder(o);
        if (canceled[h]) revert AlreadyCanceled();
        canceled[h] = true;
        emit OrderCanceled(h, msg.sender);
    }

    /// @notice Exposed for off-chain signing tools.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /* -------- internals -------- */

    function _checkTokenAllowed(address token, uint256 marketId) internal view {
        if (token == collateral) return;

        // Token must self-report conditionId and indexSet — and the factory must agree.
        // try-catch safely handles non-wrapper contracts (revert path → TokenNotAllowed).
        try IPositionWrapperRead(token).conditionId() returns (bytes32 cId) {
            try IPositionWrapperRead(token).indexSet() returns (uint256 iSet) {
                bytes32 k = IPositionWrapperFactory(factory).key(collateral, cId, iSet);
                address registered = IPositionWrapperFactory(factory).wrapperOf(k);
                if (registered != token) revert TokenNotAllowed(token, marketId);

                // Verify the wrapper's conditionId matches the market's conditionId.
                bytes32 marketConditionId = _conditionIdOf(marketId);
                if (cId != marketConditionId) revert TokenNotAllowed(token, marketId);
                return;
            } catch {
                revert TokenNotAllowed(token, marketId);
            }
        } catch {
            revert TokenNotAllowed(token, marketId);
        }
    }

    function _conditionIdOf(uint256 marketId) internal view returns (bytes32) {
        return IPredictionMarket(predictionMarket).conditionIdOf(marketId);
    }
}
