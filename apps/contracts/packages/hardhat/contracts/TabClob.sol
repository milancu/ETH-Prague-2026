// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TabClob — minimal EIP-712 ERC-20 limit order book
/// @notice Maker signs an off-chain Order (EIP-712). Taker calls `fill` on-chain
///         to atomically swap makerToken/takerToken. Both sides must approve TabClob.
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
    }

    bytes32 public constant ORDER_TYPEHASH =
        keccak256(
            "Order(address maker,address taker,address makerToken,address takerToken,uint128 makerAmount,uint128 takerAmount,uint64 expiry,uint256 salt)"
        );

    mapping(bytes32 => bool) public filled;
    mapping(bytes32 => bool) public canceled;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address makerToken,
        address takerToken,
        uint128 makerAmount,
        uint128 takerAmount
    );
    event OrderCanceled(bytes32 indexed orderHash, address indexed maker);

    constructor() EIP712("TabClob", "1") {}

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
                        o.salt
                    )
                )
            );
    }

    /// @notice Atomic swap: pulls takerAmount of takerToken from caller to maker,
    ///         then pulls makerAmount of makerToken from maker to caller.
    function fill(Order calldata o, bytes calldata signature) external nonReentrant {
        bytes32 h = hashOrder(o);
        require(!filled[h], "already filled");
        require(!canceled[h], "canceled");
        require(block.timestamp < o.expiry, "expired");
        require(o.taker == address(0) || o.taker == msg.sender, "wrong taker");
        require(o.makerAmount > 0 && o.takerAmount > 0, "zero amount");
        require(SignatureChecker.isValidSignatureNow(o.maker, h, signature), "bad signature");

        filled[h] = true;
        IERC20(o.takerToken).safeTransferFrom(msg.sender, o.maker, o.takerAmount);
        IERC20(o.makerToken).safeTransferFrom(o.maker, msg.sender, o.makerAmount);

        emit OrderFilled(h, o.maker, msg.sender, o.makerToken, o.takerToken, o.makerAmount, o.takerAmount);
    }

    /// @notice Maker invalidates an unfilled order. Idempotent: reverts if already filled/canceled.
    function cancel(Order calldata o) external {
        require(msg.sender == o.maker, "not maker");
        bytes32 h = hashOrder(o);
        require(!filled[h], "filled");
        require(!canceled[h], "already canceled");
        canceled[h] = true;
        emit OrderCanceled(h, msg.sender);
    }

    /// @notice Exposed for off-chain signing tools.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
