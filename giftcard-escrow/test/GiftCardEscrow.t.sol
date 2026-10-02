// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {GiftCardEscrow} from "../src/GiftCardEscrow.sol";

/// @dev Minimal ERC-20 for the tests. Returns bools, like USDC.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A token that reports failure by returning false rather than
///      reverting — the shape that silently loses funds if unchecked.
contract LyingToken is MockToken {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

contract GiftCardEscrowTest is Test {
    GiftCardEscrow escrow;
    MockToken token;

    address attestor = address(0xA11CE);
    address merchant = address(0xBEEF);
    address user = address(0xCAFE);
    address outsider = address(0xDEAD);

    bytes32 constant TRADE = keccak256("gct-1");
    uint256 constant AMOUNT = 88_000_000; // $88 in 6-decimal USDC

    function setUp() public {
        escrow = new GiftCardEscrow(attestor);
        token = new MockToken();
        token.mint(merchant, AMOUNT * 10);
        token.mint(user, AMOUNT * 10);
    }

    function _lockAs(address funder, address counterparty) internal {
        vm.startPrank(funder);
        token.approve(address(escrow), AMOUNT);
        escrow.lock(TRADE, address(token), AMOUNT, counterparty);
        vm.stopPrank();
    }

    // ── locking ─────────────────────────────────────────────────────────

    function test_lock_moves_the_funds_into_the_contract() public {
        _lockAs(merchant, user);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertTrue(escrow.isOpen(TRADE));
    }

    function test_the_same_trade_cannot_be_locked_twice() public {
        _lockAs(merchant, user);
        vm.startPrank(merchant);
        token.approve(address(escrow), AMOUNT);
        vm.expectRevert(GiftCardEscrow.LockExists.selector);
        escrow.lock(TRADE, address(token), AMOUNT, user);
        vm.stopPrank();
    }

    function test_a_trade_cannot_have_the_same_party_on_both_sides() public {
        vm.startPrank(merchant);
        token.approve(address(escrow), AMOUNT);
        vm.expectRevert(GiftCardEscrow.SamePartyTwice.selector);
        escrow.lock(TRADE, address(token), AMOUNT, merchant);
        vm.stopPrank();
    }

    function test_zero_amount_and_zero_addresses_are_refused() public {
        vm.startPrank(merchant);
        token.approve(address(escrow), AMOUNT);
        vm.expectRevert(GiftCardEscrow.ZeroAmount.selector);
        escrow.lock(TRADE, address(token), 0, user);
        vm.expectRevert(GiftCardEscrow.ZeroAddress.selector);
        escrow.lock(TRADE, address(token), AMOUNT, address(0));
        vm.stopPrank();
    }

    // ── release: the attestor's authority, and its limits ───────────────

    function test_attestor_can_pay_the_counterparty() public {
        _lockAs(merchant, user);
        uint256 before = token.balanceOf(user);
        vm.prank(attestor);
        escrow.release(TRADE, user);
        assertEq(token.balanceOf(user) - before, AMOUNT);
        assertFalse(escrow.isOpen(TRADE));
    }

    function test_attestor_can_refund_the_funder() public {
        _lockAs(merchant, user);
        uint256 before = token.balanceOf(merchant);
        vm.prank(attestor);
        escrow.release(TRADE, merchant);
        assertEq(token.balanceOf(merchant) - before, AMOUNT);
    }

    function test_attestor_cannot_pay_a_third_party() public {
        // The bound on the attestor's power: it picks a winner between two
        // named parties, it does not get to spend the contract.
        _lockAs(merchant, user);
        vm.prank(attestor);
        vm.expectRevert(GiftCardEscrow.NotAParty.selector);
        escrow.release(TRADE, outsider);
    }

    function test_attestor_cannot_pay_itself() public {
        _lockAs(merchant, user);
        vm.prank(attestor);
        vm.expectRevert(GiftCardEscrow.NotAParty.selector);
        escrow.release(TRADE, attestor);
    }

    function test_nobody_else_can_release() public {
        _lockAs(merchant, user);
        for (uint256 i = 0; i < 3; i++) {
            address who = [merchant, user, outsider][i];
            vm.prank(who);
            vm.expectRevert(GiftCardEscrow.NotAttestor.selector);
            escrow.release(TRADE, user);
        }
    }

    function test_a_lock_cannot_be_released_twice() public {
        // The expensive failure: paying the same escrow out two times.
        _lockAs(merchant, user);
        vm.startPrank(attestor);
        escrow.release(TRADE, user);
        vm.expectRevert(GiftCardEscrow.AlreadyReleased.selector);
        escrow.release(TRADE, merchant);
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_releasing_an_unknown_trade_reverts() public {
        vm.prank(attestor);
        vm.expectRevert(GiftCardEscrow.NoSuchLock.selector);
        escrow.release(keccak256("never-locked"), user);
    }

    // ── the refund backstop ─────────────────────────────────────────────

    function test_refund_is_not_available_before_the_delay() public {
        _lockAs(merchant, user);
        vm.warp(block.timestamp + escrow.REFUND_DELAY() - 1);
        vm.expectRevert(GiftCardEscrow.RefundNotDue.selector);
        escrow.refund(TRADE);
    }

    function test_refund_rescues_funds_from_an_absent_attestor() public {
        // Nobody should accept "the operator went away and kept my money".
        _lockAs(merchant, user);
        uint256 before = token.balanceOf(merchant);
        vm.warp(block.timestamp + escrow.REFUND_DELAY());
        vm.prank(outsider); // permissionless to call…
        escrow.refund(TRADE);
        // …but it can only ever pay the funder.
        assertEq(token.balanceOf(merchant) - before, AMOUNT);
    }

    function test_refund_cannot_follow_a_release() public {
        _lockAs(merchant, user);
        vm.prank(attestor);
        escrow.release(TRADE, user);
        vm.warp(block.timestamp + escrow.REFUND_DELAY());
        vm.expectRevert(GiftCardEscrow.AlreadyReleased.selector);
        escrow.refund(TRADE);
    }

    function test_the_refund_delay_outlasts_every_trade_deadline() public view {
        // The longest in-protocol deadline is one hour; this must be a
        // backstop against operator failure, never a race with settlement.
        assertGt(escrow.REFUND_DELAY(), 1 hours * 24);
    }

    // ── attestor handover ───────────────────────────────────────────────

    function test_attestor_handover_requires_the_new_key_to_accept() public {
        address next = address(0xFEED);
        vm.prank(attestor);
        escrow.transferAttestor(next);
        // Still the old attestor until the new one proves it is live.
        assertEq(escrow.attestor(), attestor);

        vm.prank(next);
        escrow.acceptAttestor();
        assertEq(escrow.attestor(), next);
    }

    function test_an_uninvited_address_cannot_accept_the_role() public {
        vm.prank(attestor);
        escrow.transferAttestor(address(0xFEED));
        vm.prank(outsider);
        vm.expectRevert(GiftCardEscrow.NotPendingAttestor.selector);
        escrow.acceptAttestor();
    }

    // ── token behaviour ─────────────────────────────────────────────────

    function test_a_token_that_returns_false_reverts_the_release() public {
        // Unchecked, this would mark the lock released while moving nothing.
        LyingToken bad = new LyingToken();
        bad.mint(merchant, AMOUNT);
        vm.startPrank(merchant);
        bad.approve(address(escrow), AMOUNT);
        escrow.lock(TRADE, address(bad), AMOUNT, user);
        vm.stopPrank();

        vm.prank(attestor);
        vm.expectRevert(GiftCardEscrow.TransferFailed.selector);
        escrow.release(TRADE, user);
        assertTrue(escrow.isOpen(TRADE), "a failed transfer must not consume the lock");
    }

    // ── direction independence ──────────────────────────────────────────

    function testFuzz_either_party_may_fund_and_either_may_be_paid(bool merchantFunds, bool payFunder)
        public
    {
        // The contract knows nothing about buy vs sell. Both directions are
        // the same two addresses in a different order.
        address funder = merchantFunds ? merchant : user;
        address other = merchantFunds ? user : merchant;
        _lockAs(funder, other);

        address winner = payFunder ? funder : other;
        uint256 before = token.balanceOf(winner);
        vm.prank(attestor);
        escrow.release(TRADE, winner);
        assertEq(token.balanceOf(winner) - before, AMOUNT);
    }
}
