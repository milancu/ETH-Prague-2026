// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title AnalysisResolver
/// @notice ERC-3668 (CCIP-Read) base for off-chain analysis lookups.
///         Provides OffchainLookup revert, gateway URL management,
///         and signature verification for the callback.
abstract contract AnalysisResolver {
    using ECDSA for bytes32;

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    string[] internal _gatewayUrls;
    address public signer;

    event SignerUpdated(address indexed previous, address indexed next);
    event GatewayUrlsUpdated(string[] urls);

    error InvalidSignature();
    error SignatureExpired();
    error ZeroSigner();

    function _setSigner(address newSigner) internal {
        if (newSigner == address(0)) revert ZeroSigner();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function _setGatewayUrls(string[] memory urls) internal {
        _gatewayUrls = urls;
        emit GatewayUrlsUpdated(urls);
    }

    function gatewayUrls() external view returns (string[] memory) {
        return _gatewayUrls;
    }

    /// @notice Verify a signed gateway response per EIP-191 (version 0x00).
    /// @dev Digest: keccak256(abi.encodePacked(0x1900, address(this), expires, keccak256(request), keccak256(result)))
    function _verifyGatewayResponse(
        bytes memory result,
        uint64 expires,
        bytes memory sig,
        bytes memory request
    ) internal view {
        if (block.timestamp > expires) revert SignatureExpired();

        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1900",
                address(this),
                expires,
                keccak256(request),
                keccak256(result)
            )
        );
        address recovered = digest.recover(sig);
        if (recovered != signer) revert InvalidSignature();
    }
}
