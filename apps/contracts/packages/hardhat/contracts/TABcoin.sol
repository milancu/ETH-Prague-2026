// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title TABcoin
 * @notice ERC20 token s pevně daným authorizerem:
 *  - jediný možný authorizer je 0x48c5632dCC220Abf56000F93B1C4DEB501c64588
 *  - může mintovat (emitovat) libovolnou částku
 *  - může povolit claim v násobcích (každé povolení = 1× CLAIM_AMOUNT) a případně jednotlivé povolení odebrat
 *  - držitelé mohou pálit (burn) své tokeny
 *
 *  ABI je zachováno: nezměnili jsme signatury funkcí, eventy ani public proměnné.
 */
contract TABcoin is ERC20, ERC20Burnable {
    uint8 private constant _DECIMALS = 18;
    uint256 public constant CLAIM_AMOUNT = 1000 * 10 ** _DECIMALS;

    /// @notice Pevně daný authorizer (neměnný)
    address public constant AUTHORIZER = 0x48c5632dCC220Abf56000F93B1C4DEB501c64588;

    /// @dev Původní public proměnné kvůli ABI (zůstávají):
    /// claimAuthorized: true pokud má adresa >0 povolení
    mapping(address => bool) public claimAuthorized;
    /// claimConsumed: true pokud už někdy claimovala (informativní, neblokuje další claime)
    mapping(address => bool) public claimConsumed;

    /// @dev Interní čítač počtu povolených claimů pro adresu (nezveřejňovat = nemění ABI)
    mapping(address => uint256) private _claimAllowance;

    event ClaimAuthorized(address indexed user);
    event ClaimRevoked(address indexed user);
    event Claimed(address indexed user, uint256 amount);
    event Minted(address indexed to, uint256 amount);

    error NotAuthorizer(address expected, address actual);
    error ZeroAddress();
    error ClaimNotAuthorized();

    constructor() ERC20("TABcoin", "TAB") {}

    modifier onlyAuthorizer() {
        if (msg.sender != AUTHORIZER) revert NotAuthorizer(AUTHORIZER, msg.sender);
        _;
    }

    /// @notice MOCK: kdokoli může přidat povolení claimu komukoliv. Žádný gating.
    function authorizeClaim(address user) external {
        if (user == address(0)) revert ZeroAddress();
        unchecked {
            _claimAllowance[user] += 1;
        }
        // držíme synchronizaci s původním veřejným ukazatelem
        claimAuthorized[user] = (_claimAllowance[user] > 0);
        emit ClaimAuthorized(user);
    }

    /// @notice MOCK: kdokoli může odebrat povolení komukoliv.
    function revokeClaim(address user) external {
        if (_claimAllowance[user] > 0) {
            _claimAllowance[user] -= 1;
        }
        claimAuthorized[user] = (_claimAllowance[user] > 0);
        emit ClaimRevoked(user);
    }

    /// @notice Uživatel provede claim (pokud má k dispozici alespoň jedno povolení)
    function claim() external {
        uint256 allowanceLeft = _claimAllowance[msg.sender];
        if (allowanceLeft == 0) revert ClaimNotAuthorized();

        // odebereme jedno „povolení“ a mintneme CLAIM_AMOUNT
        _claimAllowance[msg.sender] = allowanceLeft - 1;
        claimAuthorized[msg.sender] = (_claimAllowance[msg.sender] > 0);

        // historická informace – někdy claimnul
        if (!claimConsumed[msg.sender]) {
            claimConsumed[msg.sender] = true;
        }

        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice MOCK: kdokoli může mintovat libovolné množství tokenů komukoliv.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
        emit Minted(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}
