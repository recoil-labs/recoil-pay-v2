// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC-20 surface. Declared locally rather than pulled from a
/// library so this contract has no dependencies to audit alongside it.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title GiftCardEscrow
/// @notice Holds the money leg of a gift card trade until an attestation
///         decides where it goes.
///
/// # Why this exists instead of the OIF escrow
///
/// The OIF input settler releases on proof that a fill happened on the
/// destination chain. A gift card trade has no on-chain leg — the thing being
/// exchanged is a string that a brand's database either honours or does not —
/// so that proof can never exist and `finalise` could never be called. The
/// release condition here is an attestation instead, which is the only kind
/// of evidence this trade can ever produce.
///
/// # What the attestor can and cannot do
///
/// The attestor decides *which of the two parties* receives a locked amount.
/// It cannot choose a third address, cannot change the amount, cannot move
/// funds to itself, and cannot touch a lock that has already been released.
/// So a compromised attestor can misdirect a trade between its own two
/// participants — which is exactly the power a dispute adjudicator must have
/// — but cannot drain the contract.
///
/// # The refund backstop
///
/// If the attestor goes away entirely, every lock becomes refundable to its
/// funder after `REFUND_DELAY`. Without this, funds would be trapped forever
/// by an operator who simply stopped answering, and nobody should accept that
/// risk to sell a $50 card.
contract GiftCardEscrow {
    /// @dev Reverts carry no strings; selectors are cheaper and the caller
    ///      always knows which call it made.
    error NotAttestor();
    error NotPendingAttestor();
    error LockExists();
    error NoSuchLock();
    error AlreadyReleased();
    error NotAParty();
    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();
    error RefundNotDue();
    error SamePartyTwice();

    /// @notice How long after locking a funder may unilaterally reclaim, if
    ///         no attestation has arrived. Deliberately far longer than any
    ///         trade deadline (the longest is one hour), so it is a backstop
    ///         against operator failure rather than a race against normal
    ///         settlement.
    uint256 public constant REFUND_DELAY = 7 days;

    struct Lock {
        address token;
        uint256 amount;
        /// The party who funded it — and the only one a refund can reach.
        address funder;
        /// The counterparty. A release may only ever go to `funder` or here.
        address counterparty;
        uint64 lockedAt;
        bool released;
    }

    /// @notice Keyed by the aggregator's trade id, hashed. The id is opaque
    ///         on-chain; what matters is that the same trade cannot be
    ///         locked twice.
    mapping(bytes32 => Lock) public locks;

    /// @notice May direct a release between the two parties of a lock.
    address public attestor;

    /// @dev Two-step handover. A one-step `setAttestor` that fat-fingers an
    ///      address would leave every live lock releasable only by nobody,
    ///      i.e. stuck until REFUND_DELAY.
    address public pendingAttestor;

    event Locked(
        bytes32 indexed tradeId,
        address indexed funder,
        address indexed counterparty,
        address token,
        uint256 amount
    );
    event Released(bytes32 indexed tradeId, address indexed to, uint256 amount);
    event Refunded(bytes32 indexed tradeId, address indexed to, uint256 amount);
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

    /// @notice Lock `amount` of `token` against `tradeId`.
    /// @dev Callable by anyone, but the caller is recorded as the funder and
    ///      a refund can only ever reach them — so locking on someone else's
    ///      behalf costs the caller their own money and gains them nothing.
    function lock(bytes32 tradeId, address token, uint256 amount, address counterparty) external {
        if (locks[tradeId].lockedAt != 0) revert LockExists();
        if (token == address(0) || counterparty == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (counterparty == msg.sender) revert SamePartyTwice();

        locks[tradeId] = Lock({
            token: token,
            amount: amount,
            funder: msg.sender,
            counterparty: counterparty,
            lockedAt: uint64(block.timestamp),
            released: false
        });

        // State is written before the external call: a token with a transfer
        // hook could otherwise re-enter and lock the same trade id twice.
        _pull(token, msg.sender, amount);
        emit Locked(tradeId, msg.sender, counterparty, token, amount);
    }

    /// @notice Send a lock to one of its two parties.
    /// @param to Must be the lock's funder or its counterparty. Any other
    ///        address reverts, which is what bounds the attestor's authority
    ///        to "pick a winner" rather than "spend the contract".
    function release(bytes32 tradeId, address to) external onlyAttestor {
        Lock storage l = locks[tradeId];
        if (l.lockedAt == 0) revert NoSuchLock();
        if (l.released) revert AlreadyReleased();
        if (to != l.funder && to != l.counterparty) revert NotAParty();

        l.released = true;
        _push(l.token, to, l.amount);
        emit Released(tradeId, to, l.amount);
    }

    /// @notice Reclaim a lock the attestor never resolved.
    /// @dev Permissionless to call but pays only the funder, so anyone may
    ///      rescue a stuck trade on their behalf — useful when the funder is
    ///      a contract or has lost gas.
    function refund(bytes32 tradeId) external {
        Lock storage l = locks[tradeId];
        if (l.lockedAt == 0) revert NoSuchLock();
        if (l.released) revert AlreadyReleased();
        if (block.timestamp < l.lockedAt + REFUND_DELAY) revert RefundNotDue();

        l.released = true;
        _push(l.token, l.funder, l.amount);
        emit Refunded(tradeId, l.funder, l.amount);
    }

    /// @notice Begin handing the attestor role to `next`.
    function transferAttestor(address next) external onlyAttestor {
        if (next == address(0)) revert ZeroAddress();
        pendingAttestor = next;
        emit AttestorTransferStarted(msg.sender, next);
    }

    /// @notice Accept the attestor role. Proves the new key is live before
    ///         the old one stops working.
    function acceptAttestor() external {
        if (msg.sender != pendingAttestor) revert NotPendingAttestor();
        address previous = attestor;
        attestor = msg.sender;
        pendingAttestor = address(0);
        emit AttestorTransferred(previous, msg.sender);
    }

    /// @notice Whether a lock exists and is still held.
    function isOpen(bytes32 tradeId) external view returns (bool) {
        Lock storage l = locks[tradeId];
        return l.lockedAt != 0 && !l.released;
    }

    /// @dev Tolerates the non-standard ERC-20s that return nothing (USDT and
    ///      friends) by treating an empty return as success, while still
    ///      rejecting an explicit `false`.
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
