// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title PositionWrapper
/// @notice 1:1 ERC-20 obal ERC-1155 conditional pozice. Implementační kontrakt pro EIP-1167 klony.
///         Každý klon je svázán s jedním (collateralToken, conditionId, indexSet) → konkrétní positionId v CT.
///         Žádný konstruktor — používej `initialize` (factory volá hned po `Clones.clone`).
contract PositionWrapper is Initializable, ERC20Upgradeable, IERC1155Receiver {
    address public ct;
    uint256 public positionId;
    bytes32 public conditionId;
    uint256 public indexSet;
    address public collateral;

    error ZeroAmount();

    function initialize(
        string memory name_,
        string memory symbol_,
        address ct_,
        uint256 positionId_,
        bytes32 conditionId_,
        uint256 indexSet_,
        address collateral_
    ) external initializer {
        __ERC20_init(name_, symbol_);
        ct = ct_;
        positionId = positionId_;
        conditionId = conditionId_;
        indexSet = indexSet_;
        collateral = collateral_;
    }

    /// @notice Uživatel obalí `amount` ERC-1155 pozic na ERC-20 wrapped tokeny.
    ///         Předtím musí volat `ct.setApprovalForAll(thisWrapper, true)`.
    function wrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC1155(ct).safeTransferFrom(msg.sender, address(this), positionId, amount, "");
        _mint(msg.sender, amount);
    }

    /// @notice Spálí `amount` wrapped ERC-20 a vrátí stejné množství ERC-1155 pozice.
    function unwrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
        IERC1155(ct).safeTransferFrom(address(this), msg.sender, positionId, amount, "");
    }

    // ---- IERC1155Receiver ----
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
