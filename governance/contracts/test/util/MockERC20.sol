// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

/**
 * @title MockERC20
 * @notice Minimal mint/transfer token standing in for a real asset held by the Safe, so a proposal
 *         transaction (or an attempted, blocked one) has an observable effect.
 * @dev No OpenZeppelin dependency: nothing under test inspects ERC20 semantics beyond a balance changing,
 *      so a full standard-compliant implementation (allowances, approvals, metadata) is not needed to prove
 *      any invariant this suite checks.
 */
contract MockERC20 {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
