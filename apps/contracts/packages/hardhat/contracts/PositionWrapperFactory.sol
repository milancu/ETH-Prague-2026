// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

interface IPositionWrapperInit {
    function initialize(
        string memory name_,
        string memory symbol_,
        address ct_,
        uint256 positionId_,
        bytes32 conditionId_,
        uint256 indexSet_,
        address collateral_
    ) external;
}

interface IConditionalTokensIds {
    function getCollectionId(bytes32 conditionId, uint256 indexSet) external pure returns (bytes32);
    function getPositionId(address collateralToken, bytes32 collectionId) external pure returns (uint256);
}

/// @title PositionWrapperFactory
/// @notice Vyrábí na požádání (idempotentně) `PositionWrapper` klony pro každý
///         `(collateralToken, conditionId, indexSet)`. Mapping je deterministický.
contract PositionWrapperFactory {
    address public immutable wrapperImpl;
    address public immutable ct;

    /// @dev key = keccak256(collateral, conditionId, indexSet) → wrapper clone
    mapping(bytes32 => address) public wrapperOf;

    event WrapperCreated(
        address indexed collateral,
        bytes32 indexed conditionId,
        uint256 indexSet,
        uint256 positionId,
        address wrapper
    );

    error ZeroAddress();

    constructor(address _wrapperImpl, address _ct) {
        if (_wrapperImpl == address(0)) revert ZeroAddress();
        if (_ct == address(0)) revert ZeroAddress();
        wrapperImpl = _wrapperImpl;
        ct = _ct;
    }

    function key(address collateral, bytes32 conditionId, uint256 indexSet) public pure returns (bytes32) {
        return keccak256(abi.encode(collateral, conditionId, indexSet));
    }

    function getWrapper(address collateral, bytes32 conditionId, uint256 indexSet) external view returns (address) {
        return wrapperOf[key(collateral, conditionId, indexSet)];
    }

    /// @notice Vrátí existující wrapper, případně ho vytvoří. Bezpečné volat z UI před každým wrap().
    function getOrCreateWrapper(
        address collateral,
        bytes32 conditionId,
        uint256 indexSet
    ) external returns (address w) {
        bytes32 k = key(collateral, conditionId, indexSet);
        w = wrapperOf[k];
        if (w != address(0)) return w;

        bytes32 collectionId = IConditionalTokensIds(ct).getCollectionId(conditionId, indexSet);
        uint256 positionId = IConditionalTokensIds(ct).getPositionId(collateral, collectionId);

        // Krátký hex prefix klíče pro lidsky čitelné jméno tokenu.
        string memory shortKey = _toHexShort(k);
        string memory name_ = string(abi.encodePacked("Wrapped Position ", shortKey));
        string memory symbol_ = string(abi.encodePacked("wPOS-", shortKey));

        w = Clones.clone(wrapperImpl);
        IPositionWrapperInit(w).initialize(name_, symbol_, ct, positionId, conditionId, indexSet, collateral);
        wrapperOf[k] = w;

        emit WrapperCreated(collateral, conditionId, indexSet, positionId, w);
    }

    /// @dev Prvních 4 bajty `bytes32` v hex (8 znaků). Stačí pro identifikaci wrapperu na úrovni UI.
    function _toHexShort(bytes32 v) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(8);
        for (uint256 i = 0; i < 4; i++) {
            uint8 b = uint8(v[i]);
            result[i * 2] = hexChars[b >> 4];
            result[i * 2 + 1] = hexChars[b & 0x0f];
        }
        return string(result);
    }
}
