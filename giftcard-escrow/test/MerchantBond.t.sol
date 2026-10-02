// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MerchantBond} from "../src/MerchantBond.sol";

contract BondToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
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

contract MerchantBondTest is Test {
    MerchantBond bond;
    BondToken token;

    address attestor = address(0xA11CE);
    address merchant = address(0xBEEF);
    address wronged = address(0xCAFE);
    address outsider = address(0xD00D);

    uint256 constant STAKE = 1000e6; // $1000 USDC
    bytes32 constant TRADE = keccak256("gct-1");

    function setUp() public {
        bond = new MerchantBond(attestor);
        token = new BondToken();
        token.mint(merchant, STAKE * 10);
    }

    function _stake(uint256 amount) internal {
        vm.startPrank(merchant);
        token.approve(address(bond), amount);
        bond.deposit(merchant, address(token), amount);
        vm.stopPrank();
    }

    // ── staking ─────────────────────────────────────────────────────────

    function test_deposit_credits_the_merchant() public {
        _stake(STAKE);
        (uint256 amount,,) = bond.bonds(merchant, address(token));
        assertEq(amount, STAKE);
        assertEq(bond.availableBond(merchant, address(token)), STAKE);
    }

    function test_anyone_may_top_up_a_merchants_bond() public {
        // It only ever costs the sender, so this is safe and sometimes
        // useful — an operator fronting a new merchant's stake, say.
        token.mint(outsider, STAKE);
        vm.startPrank(outsider);
        token.approve(address(bond), STAKE);
        bond.deposit(merchant, address(token), STAKE);
        vm.stopPrank();
        (uint256 amount,,) = bond.bonds(merchant, address(token));
        assertEq(amount, STAKE);
    }

    // ── withdrawal is delayed ───────────────────────────────────────────

    function test_withdrawal_waits_out_the_delay() public {
        _stake(STAKE);
        vm.prank(merchant);
        bond.requestWithdrawal(address(token), STAKE);

        vm.prank(merchant);
        vm.expectRevert(MerchantBond.WithdrawalNotReady.selector);
        bond.withdraw(address(token));

        vm.warp(block.timestamp + bond.WITHDRAWAL_DELAY());
        uint256 before = token.balanceOf(merchant);
        vm.prank(merchant);
        bond.withdraw(address(token));
        assertEq(token.balanceOf(merchant) - before, STAKE);
    }

    function test_a_withdrawal_can_be_cancelled() public {
        _stake(STAKE);
        vm.startPrank(merchant);
        bond.requestWithdrawal(address(token), STAKE);
        bond.cancelWithdrawal(address(token));
        vm.expectRevert(MerchantBond.NoWithdrawalRequested.selector);
        bond.withdraw(address(token));
        vm.stopPrank();
    }

    // ── a merchant cannot outrun a claim ────────────────────────────────

    function test_a_pending_slash_blocks_starting_a_withdrawal() public {
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), 100e6, wronged, TRADE);

        vm.prank(merchant);
        vm.expectRevert(MerchantBond.SlashPending.selector);
        bond.requestWithdrawal(address(token), STAKE);
    }

    function test_a_slash_raised_mid_withdrawal_still_wins() public {
        // The exact escape a merchant would try: ask to withdraw, then wait
        // out the delay hoping the claim lands too late.
        _stake(STAKE);
        vm.prank(merchant);
        bond.requestWithdrawal(address(token), STAKE);

        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), 100e6, wronged, TRADE);

        vm.warp(block.timestamp + bond.WITHDRAWAL_DELAY());
        vm.prank(merchant);
        vm.expectRevert(MerchantBond.SlashPending.selector);
        bond.withdraw(address(token));
    }

    // ── slashing is delayed, visible and cancellable ────────────────────

    function test_a_slash_cannot_execute_immediately() public {
        // The bound on a compromised attestor: no instant drain.
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), STAKE, wronged, TRADE);

        vm.expectRevert(MerchantBond.SlashNotReady.selector);
        bond.executeSlash(merchant, address(token));
    }

    function test_a_matured_slash_pays_the_wronged_party() public {
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), 400e6, wronged, TRADE);

        vm.warp(block.timestamp + bond.SLASH_DELAY());
        // Permissionless: the claimant should not depend on the operator
        // remembering to come back for it.
        vm.prank(outsider);
        bond.executeSlash(merchant, address(token));

        assertEq(token.balanceOf(wronged), 400e6);
        (uint256 remaining,,) = bond.bonds(merchant, address(token));
        assertEq(remaining, STAKE - 400e6);
    }

    function test_a_rotated_attestor_can_cancel_what_the_old_one_proposed() public {
        // The recovery path if the attestor key is compromised: rotate, then
        // cancel the malicious proposals before they mature.
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), STAKE, outsider, TRADE);

        address rescue = address(0xFEED);
        vm.prank(attestor);
        bond.transferAttestor(rescue);
        vm.prank(rescue);
        bond.acceptAttestor();

        vm.prank(rescue);
        bond.cancelSlash(merchant, address(token));

        vm.warp(block.timestamp + bond.SLASH_DELAY());
        vm.expectRevert(MerchantBond.NoSlashPending.selector);
        bond.executeSlash(merchant, address(token));
        assertEq(token.balanceOf(outsider), 0);
    }

    function test_only_the_attestor_may_propose_or_cancel() public {
        _stake(STAKE);
        for (uint256 i = 0; i < 3; i++) {
            address who = [merchant, wronged, outsider][i];
            vm.prank(who);
            vm.expectRevert(MerchantBond.NotAttestor.selector);
            bond.proposeSlash(merchant, address(token), 1e6, who, TRADE);
        }
    }

    function test_a_slash_cannot_exceed_the_bond() public {
        _stake(STAKE);
        vm.prank(attestor);
        vm.expectRevert(MerchantBond.SlashTooLarge.selector);
        bond.proposeSlash(merchant, address(token), STAKE + 1, wronged, TRADE);
    }

    function test_only_one_slash_is_pending_at_a_time() public {
        // Otherwise a flood of proposals could freeze a bond indefinitely
        // while hiding a real claim among them.
        _stake(STAKE);
        vm.startPrank(attestor);
        bond.proposeSlash(merchant, address(token), 1e6, wronged, TRADE);
        vm.expectRevert(MerchantBond.SlashPending.selector);
        bond.proposeSlash(merchant, address(token), 1e6, wronged, TRADE);
        vm.stopPrank();
    }

    function test_executing_twice_pays_once() public {
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), 100e6, wronged, TRADE);
        vm.warp(block.timestamp + bond.SLASH_DELAY());

        bond.executeSlash(merchant, address(token));
        vm.expectRevert(MerchantBond.NoSlashPending.selector);
        bond.executeSlash(merchant, address(token));
        assertEq(token.balanceOf(wronged), 100e6);
    }

    // ── exposure accounting ─────────────────────────────────────────────

    function test_available_bond_excludes_an_earmarked_slash() public {
        // An exposure cap computed from the posted amount would let a
        // merchant keep taking trades against a stake already spoken for.
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), 400e6, wronged, TRADE);
        assertEq(bond.availableBond(merchant, address(token)), STAKE - 400e6);
    }

    function test_available_bond_never_underflows() public {
        _stake(STAKE);
        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), STAKE, wronged, TRADE);
        assertEq(bond.availableBond(merchant, address(token)), 0);
    }

    function testFuzz_a_slash_never_takes_more_than_was_staked(uint96 stake, uint96 claim) public {
        vm.assume(stake > 0 && claim > 0 && claim <= stake);
        token.mint(merchant, stake);
        _stake(stake);

        vm.prank(attestor);
        bond.proposeSlash(merchant, address(token), claim, wronged, TRADE);
        vm.warp(block.timestamp + bond.SLASH_DELAY());
        bond.executeSlash(merchant, address(token));

        assertEq(token.balanceOf(wronged), claim);
        (uint256 remaining,,) = bond.bonds(merchant, address(token));
        assertEq(remaining, uint256(stake) - claim);
    }
}
