// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MerchantBond
/// @notice A merchant's stake, and the thing that makes a dispute ruling
///         enforceable instead of advisory.
///
/// # Why a bond at all
///
/// One leg of a gift card trade is unverifiable by any contract, so the
/// escrow can only ever pick between the two parties — it cannot create
/// restitution out of nothing. When a merchant is found to have taken a card
/// and claimed it was bad, the escrow alone has nothing left to give the
/// seller. The bond is where that money comes from, and the reason a
/// merchant's promise is worth anything.
///
/// # Bounding the attestor
///
/// Slashing is strictly more dangerous than releasing an escrow: the escrow
/// is bounded to a lock's two named parties, while a slash names an
/// arbitrary recipient. A compromised attestor with an instant slash could
/// drain every bond on the platform in one transaction.
///
/// So slashes are **proposed, then executed after a delay**. During the
/// delay the merchant can see the claim, the operator can rotate a
/// compromised attestor, and the incoming attestor can cancel anything the
/// old one proposed. The delay is the difference between "an attacker steals
/// every bond" and "an attacker causes a visible, cancellable alarm".
///
/// A pending slash also freezes withdrawal, so a merchant cannot watch a
/// claim land and pull their stake out from under it.
contract MerchantBond {
    error NotAttestor();
    error NotPendingAttestor();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBond();
    error TransferFailed();
    error WithdrawalPending();
    error NoWithdrawalRequested();
    error WithdrawalNotReady();
    error SlashPending();
    error NoSlashPending();
    error SlashNotReady();
    error SlashTooLarge();

    /// @notice How long a merchant must wait between asking to withdraw and
    ///         receiving. Long enough that a counterparty wronged in a trade
    ///         still in flight can raise it before the stake leaves.
    uint256 public constant WITHDRAWAL_DELAY = 3 days;

    /// @notice How long a proposed slash sits visible before it can be
    ///         executed. See the note above on bounding the attestor.
    uint256 public constant SLASH_DELAY = 24 hours;

    struct Bond {
        uint256 amount;
        /// Non-zero while a withdrawal is pending; the timestamp it unlocks.
        uint64 withdrawableAt;
        uint256 withdrawRequested;
    }

    struct PendingSlash {
        uint256 amount;
        address beneficiary;
        uint64 executableAt;
        /// Free-form reference to the dispute this answers, for the record.
        bytes32 tradeId;
    }

    /// merchant => token => bond
    mapping(address => mapping(address => Bond)) public bonds;
    /// merchant => token => the one pending slash
    mapping(address => mapping(address => PendingSlash)) public pendingSlashes;

    address public attestor;
    address public pendingAttestor;

    event Deposited(address indexed merchant, address indexed token, uint256 amount);
    event WithdrawalRequested(
        address indexed merchant, address indexed token, uint256 amount, uint64 readyAt
    );
    event WithdrawalCancelled(address indexed merchant, address indexed token);
    event Withdrawn(address indexed merchant, address indexed token, uint256 amount);
    event SlashProposed(
        address indexed merchant,
        address indexed token,
        address indexed beneficiary,
        uint256 amount,
        bytes32 tradeId,
        uint64 executableAt
    );
    event SlashCancelled(address indexed merchant, address indexed token);
    event Slashed(
        address indexed merchant, address indexed token, address indexed beneficiary, uint256 amount
    );
    event AttestorTransferStarted(address indexed from, address indexed to);
    event AttestorTransferred(address indexed from, address indexed to);

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    constructor(address attestor_) {
        if (attestor_ == address(0)) revert ZeroAddress();
        attestor = attestor_;
        emit AttestorTransferred(address(0), attestor_);
    }

    /// @notice Add to your bond. Anyone may top up any merchant — the stake
    ///         belongs to the merchant either way, so funding someone else's
    ///         bond only costs the sender.
    function deposit(address merchant, address token, uint256 amount) external {
        if (merchant == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bonds[merchant][token].amount += amount;
        _pull(token, msg.sender, amount);
        emit Deposited(merchant, token, amount);
    }

    /// @notice Start the clock on taking `amount` back out.
    /// @dev Refused while a slash is pending: otherwise a merchant could
    ///      watch a claim arrive and exit ahead of it.
    function requestWithdrawal(address token, uint256 amount) external {
        Bond storage b = bonds[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        if (amount > b.amount) revert InsufficientBond();
        if (b.withdrawableAt != 0) revert WithdrawalPending();
        if (pendingSlashes[msg.sender][token].amount != 0) revert SlashPending();

        b.withdrawRequested = amount;
        b.withdrawableAt = uint64(block.timestamp + WITHDRAWAL_DELAY);
        emit WithdrawalRequested(msg.sender, token, amount, b.withdrawableAt);
    }

    /// @notice Abandon a pending withdrawal and put the stake back to work.
    function cancelWithdrawal(address token) external {
        Bond storage b = bonds[msg.sender][token];
        if (b.withdrawableAt == 0) revert NoWithdrawalRequested();
        b.withdrawableAt = 0;
        b.withdrawRequested = 0;
        emit WithdrawalCancelled(msg.sender, token);
    }

    /// @notice Take out a matured withdrawal.
    function withdraw(address token) external {
        Bond storage b = bonds[msg.sender][token];
        if (b.withdrawableAt == 0) revert NoWithdrawalRequested();
        if (block.timestamp < b.withdrawableAt) revert WithdrawalNotReady();
        // A slash proposed during the waiting period wins: the claim was
        // raised while the stake was still committed.
        if (pendingSlashes[msg.sender][token].amount != 0) revert SlashPending();

        uint256 amount = b.withdrawRequested;
        // A slash may have reduced the bond below what was requested.
        if (amount > b.amount) amount = b.amount;

        b.amount -= amount;
        b.withdrawableAt = 0;
        b.withdrawRequested = 0;

        _push(token, msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Propose taking `amount` from a merchant's bond for
    ///         `beneficiary`. Executable after `SLASH_DELAY`.
    /// @dev One pending slash per (merchant, token) at a time, so a flood of
    ///      proposals cannot be used to freeze a bond indefinitely while
    ///      hiding a real one among them.
    function proposeSlash(
        address merchant,
        address token,
        uint256 amount,
        address beneficiary,
        bytes32 tradeId
    ) external onlyAttestor {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > bonds[merchant][token].amount) revert SlashTooLarge();
        if (pendingSlashes[merchant][token].amount != 0) revert SlashPending();

        uint64 executableAt = uint64(block.timestamp + SLASH_DELAY);
        pendingSlashes[merchant][token] =
            PendingSlash({amount: amount, beneficiary: beneficiary, executableAt: executableAt, tradeId: tradeId});

        emit SlashProposed(merchant, token, beneficiary, amount, tradeId, executableAt);
    }

    /// @notice Drop a proposed slash.
    /// @dev The escape hatch for a compromised attestor: rotate the key, then
    ///      have the incoming one cancel whatever the old one proposed.
    function cancelSlash(address merchant, address token) external onlyAttestor {
        if (pendingSlashes[merchant][token].amount == 0) revert NoSlashPending();
        delete pendingSlashes[merchant][token];
        emit SlashCancelled(merchant, token);
    }

    /// @notice Execute a matured slash.
    /// @dev Permissionless once mature: the decision was made and published
    ///      at proposal time, and a wronged party should not depend on the
    ///      operator remembering to come back for it.
    function executeSlash(address merchant, address token) external {
        PendingSlash memory p = pendingSlashes[merchant][token];
        if (p.amount == 0) revert NoSlashPending();
        if (block.timestamp < p.executableAt) revert SlashNotReady();

        Bond storage b = bonds[merchant][token];
        uint256 amount = p.amount;
        // The bond can only have shrunk via another slash; pay what is left
        // rather than reverting and stranding the claim entirely.
        if (amount > b.amount) amount = b.amount;

        b.amount -= amount;
        delete pendingSlashes[merchant][token];

        _push(token, p.beneficiary, amount);
        emit Slashed(merchant, token, p.beneficiary, amount);
    }

    /// @notice The stake currently backing a merchant's promises — what is
    ///         posted, less anything already earmarked by a pending slash.
    ///         This is the figure an exposure cap should be computed from.
    function availableBond(address merchant, address token) external view returns (uint256) {
        uint256 posted = bonds[merchant][token].amount;
        uint256 earmarked = pendingSlashes[merchant][token].amount;
        return posted > earmarked ? posted - earmarked : 0;
    }

    function transferAttestor(address next) external onlyAttestor {
        if (next == address(0)) revert ZeroAddress();
        pendingAttestor = next;
        emit AttestorTransferStarted(msg.sender, next);
    }

    function acceptAttestor() external {
        if (msg.sender != pendingAttestor) revert NotPendingAttestor();
        address previous = attestor;
        attestor = msg.sender;
        pendingAttestor = address(0);
        emit AttestorTransferred(previous, msg.sender);
    }

    function _pull(address token, address from, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _push(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
