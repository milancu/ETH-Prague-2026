// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockENSRegistry
/// @notice Minimal ENS registry mock for local Hardhat testing.
///         NOT for production — only supports setSubnodeRecord and owner lookups.
contract MockENSRegistry {
    mapping(bytes32 => address) private _owners;
    mapping(bytes32 => address) private _resolvers;

    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);

    constructor() {
        // Root node owned by deployer
        _owners[bytes32(0)] = msg.sender;
    }

    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address nodeOwner,
        address res,
        uint64 /* ttl */
    ) external {
        require(_owners[node] == msg.sender, "not owner");
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        _owners[subnode] = nodeOwner;
        _resolvers[subnode] = res;
        emit NewOwner(node, label, nodeOwner);
    }

    function setOwner(bytes32 node, address nodeOwner) external {
        require(_owners[node] == msg.sender, "not owner");
        _owners[node] = nodeOwner;
    }

    function setResolver(bytes32 node, address res) external {
        require(_owners[node] == msg.sender, "not owner");
        _resolvers[node] = res;
    }

    function owner(bytes32 node) external view returns (address) {
        return _owners[node];
    }

    function resolver(bytes32 node) external view returns (address) {
        return _resolvers[node];
    }

    /// @notice Claim the "eth" TLD and a second-level name for testing.
    function claimName(bytes32 parentNode, bytes32 label) external {
        require(_owners[parentNode] == msg.sender, "not owner");
        bytes32 subnode = keccak256(abi.encodePacked(parentNode, label));
        _owners[subnode] = msg.sender;
    }
}
