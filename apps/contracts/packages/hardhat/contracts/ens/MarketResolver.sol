// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AnalysisResolver} from "./AnalysisResolver.sol";

/// @title MarketResolver
/// @notice ENS resolver for prediction-market subnames under kowalski.eth.
///
///  Track 1 — State oracle: stores mirrored text records and addr records
///            updated by the indexer bridge when PMv2 events fire.
///
///  Track 2 — CCIP-Read analysis: implements ENSIP-10 resolve().  When the
///            queried DNS name starts with "analyze.", reverts with
///            OffchainLookup (ERC-3668) pointing at our x402-gated gateway.
///            The resolveWithProof callback verifies the gateway signature.
contract MarketResolver is AnalysisResolver {
    // ── ERC-165 interface IDs ─────────────────────────────────────
    bytes4 private constant IADDR_RESOLVER       = 0x3b3b57de; // addr(bytes32)
    bytes4 private constant ITEXT_RESOLVER       = 0x59d1d43c; // text(bytes32,string)
    bytes4 private constant ISUPPORTS_INTERFACE  = 0x01ffc9a7;
    bytes4 private constant IEXTENDED_RESOLVER   = 0x9061b923; // resolve(bytes,bytes)

    // ── Storage ───────────────────────────────────────────────────
    mapping(bytes32 => mapping(string => string)) private _texts;
    mapping(bytes32 => address) private _addrs;
    mapping(bytes32 => uint256) private _marketIds;

    address public admin;

    // ── Errors ────────────────────────────────────────────────────
    error NotAdmin();
    error ZeroAdmin();

    // ── Events ────────────────────────────────────────────────────
    event TextChanged(bytes32 indexed node, string key, string value);
    event AddrChanged(bytes32 indexed node, address addr);
    event AdminTransferred(address indexed previous, address indexed next);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address _admin,
        address _signer,
        string[] memory urls
    ) {
        if (_admin == address(0)) revert ZeroAdmin();
        admin = _admin;
        _setSigner(_signer);
        _setGatewayUrls(urls);
    }

    // ── Admin management ──────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAdmin();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function setSigner(address newSigner) external onlyAdmin {
        _setSigner(newSigner);
    }

    function setGatewayUrls(string[] calldata urls) external onlyAdmin {
        _setGatewayUrls(urls);
    }

    // ── Track 1: text / addr record storage (called by indexer) ──

    function setText(bytes32 node, string calldata key, string calldata value) external onlyAdmin {
        _texts[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function setTexts(
        bytes32 node,
        string[] calldata keys,
        string[] calldata values
    ) external onlyAdmin {
        for (uint256 i = 0; i < keys.length; i++) {
            _texts[node][keys[i]] = values[i];
            emit TextChanged(node, keys[i], values[i]);
        }
    }

    function setAddr(bytes32 node, address a) external onlyAdmin {
        _addrs[node] = a;
        emit AddrChanged(node, a);
    }

    function setMarketId(bytes32 node, uint256 id) external onlyAdmin {
        _marketIds[node] = id;
    }

    // ── Standard resolver reads (EIP-137 / EIP-634) ──────────────

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function addr(bytes32 node) external view returns (address) {
        return _addrs[node];
    }

    function marketId(bytes32 node) external view returns (uint256) {
        return _marketIds[node];
    }

    // ── ENSIP-10 wildcard resolve ─────────────────────────────────

    /// @notice Entry point for ENSIP-10. Handles both direct subname lookups
    ///         and "analyze." prefixed CCIP-Read lookups.
    function resolve(
        bytes calldata name,
        bytes calldata data
    ) external view returns (bytes memory) {
        // Check if the first DNS label is "analyze"
        if (_firstLabelIs(name, "analyze")) {
            // Track 2: revert with OffchainLookup for CCIP-Read
            revert OffchainLookup(
                address(this),
                _gatewayUrls,
                data,          // original calldata (text(node,key) etc.)
                this.resolveWithProof.selector,
                abi.encode(name, data)  // extraData for callback
            );
        }

        // Track 1: direct text/addr record lookup via stored data.
        // Decode the inner function call and dispatch.
        bytes4 selector = bytes4(data[:4]);

        if (selector == ITEXT_RESOLVER) {
            // text(bytes32 node, string key)
            (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
            string memory val = _texts[node][key];
            return abi.encode(val);
        }

        if (selector == IADDR_RESOLVER) {
            // addr(bytes32 node)
            bytes32 node = abi.decode(data[4:], (bytes32));
            address a = _addrs[node];
            return abi.encode(a);
        }

        // Unsupported selector — return empty
        return "";
    }

    /// @notice ERC-3668 callback: verifies the gateway signature and returns data.
    function resolveWithProof(
        bytes calldata response,
        bytes calldata extraData
    ) external view returns (bytes memory) {
        (bytes memory result, uint64 expires, bytes memory sig) =
            abi.decode(response, (bytes, uint64, bytes));

        // extraData = abi.encode(name, originalCalldata)
        (bytes memory name, bytes memory originalData) =
            abi.decode(extraData, (bytes, bytes));

        // Reconstruct the request for signature verification
        bytes memory request = abi.encodePacked(name, originalData);

        _verifyGatewayResponse(result, expires, sig, request);

        return result;
    }

    // ── ERC-165 ──────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == ISUPPORTS_INTERFACE ||
            interfaceId == IADDR_RESOLVER ||
            interfaceId == ITEXT_RESOLVER ||
            interfaceId == IEXTENDED_RESOLVER;
    }

    // ── DNS name parsing ─────────────────────────────────────────

    /// @dev Check if the first label of a DNS-encoded name equals `target`.
    ///      DNS encoding: [length][label][length][label]...[0x00]
    function _firstLabelIs(
        bytes calldata name,
        string memory target
    ) internal pure returns (bool) {
        if (name.length == 0) return false;
        uint8 labelLen = uint8(name[0]);
        if (labelLen == 0) return false;
        if (name.length < uint256(labelLen) + 1) return false;
        bytes memory targetBytes = bytes(target);
        if (labelLen != targetBytes.length) return false;
        for (uint256 i = 0; i < labelLen; i++) {
            if (name[i + 1] != targetBytes[i]) return false;
        }
        return true;
    }
}
