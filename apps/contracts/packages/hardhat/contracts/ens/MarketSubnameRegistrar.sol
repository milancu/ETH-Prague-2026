// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ENS registry interface (EIP-137).
interface IENS {
    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address owner,
        address resolver,
        uint64 ttl
    ) external;
    function owner(bytes32 node) external view returns (address);
}

/// @notice Minimal NameWrapper interface for creating subnames.
interface INameWrapper {
    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node);

    function ownerOf(uint256 id) external view returns (address);
    function isApprovedForAll(address account, address operator) external view returns (bool);
}

/// @title MarketSubnameRegistrar
/// @notice Auto-mints ENS subnames under a parent name (e.g. kowalski.eth)
///         when new prediction markets are created. Sets the MarketResolver
///         as the resolver for each subname.
///
///         Works with NameWrapper (modern Sepolia ENS) — the parent name owner
///         must call nameWrapper.setApprovalForAll(thisContract, true).
contract MarketSubnameRegistrar {
    IENS public immutable registry;
    INameWrapper public immutable nameWrapper;
    address public resolver;
    bytes32 public parentNode;
    address public admin;
    bool public useNameWrapper;

    mapping(uint256 => bytes32) public marketNodes;
    mapping(bytes32 => uint256) public nodeToMarketId;
    mapping(string => bool) public slugTaken;

    event SubnameRegistered(
        uint256 indexed marketId,
        string slug,
        bytes32 indexed node
    );
    event ResolverUpdated(address indexed previous, address indexed next);
    event AdminTransferred(address indexed previous, address indexed next);

    error NotAdmin();
    error ZeroAddress();
    error SlugAlreadyTaken(string slug);
    error MarketAlreadyRegistered(uint256 marketId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address _registry,
        address _nameWrapper,
        address _resolver,
        bytes32 _parentNode,
        address _admin,
        bool _useNameWrapper
    ) {
        if (_registry == address(0)) revert ZeroAddress();
        if (_resolver == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();
        registry = IENS(_registry);
        nameWrapper = INameWrapper(_nameWrapper);
        resolver = _resolver;
        parentNode = _parentNode;
        admin = _admin;
        useNameWrapper = _useNameWrapper;
    }

    /// @notice Register a subname for a market.
    /// @param slug The DNS label (e.g. "slavia-titul-2026")
    /// @param marketId The PMv2 market ID
    function registerMarket(
        string calldata slug,
        uint256 marketId
    ) external onlyAdmin returns (bytes32 node) {
        if (slugTaken[slug]) revert SlugAlreadyTaken(slug);
        if (marketNodes[marketId] != bytes32(0))
            revert MarketAlreadyRegistered(marketId);

        if (useNameWrapper) {
            node = nameWrapper.setSubnodeRecord(
                parentNode,
                slug,
                admin,     // subname owner — admin can update records
                resolver,
                0,         // ttl
                0,         // fuses (none burned — fully flexible)
                type(uint64).max  // expiry — max for hackathon
            );
        } else {
            bytes32 label = keccak256(bytes(slug));
            node = keccak256(abi.encodePacked(parentNode, label));
            registry.setSubnodeRecord(
                parentNode,
                label,
                admin,
                resolver,
                0
            );
        }

        marketNodes[marketId] = node;
        nodeToMarketId[node] = marketId;
        slugTaken[slug] = true;

        emit SubnameRegistered(marketId, slug, node);
    }

    function setResolver(address newResolver) external onlyAdmin {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
