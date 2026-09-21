// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

import {Enum, ISafe} from "@/interfaces/ISafe.sol";

/**
 * @title MockSafe
 * @notice A bare `ISafe` test double for unit-testing `RealityVetoModule` in isolation from a real Safe: it
 *         records the exact arguments of the last `execTransactionFromModule` call and returns whatever
 *         `shouldSucceed` was last set to, with none of a real Safe's owner, threshold or module bookkeeping.
 */
contract MockSafe is ISafe {
    uint256 public callCount;
    address public lastTo;
    uint256 public lastValue;
    bytes public lastData;
    Enum.Operation public lastOperation;
    bool public shouldSucceed = true;

    /// @dev Set to revert instead of returning `false`, standing in for a real Safe's own reverting checks
    ///      (e.g. `GS104` for a caller that is not an enabled module) so a test can confirm the module does
    ///      not wrap or swallow that revert into its own `VetoFailed`.
    string public revertReason;

    function setShouldSucceed(bool value) external {
        shouldSucceed = value;
    }

    function setRevertReason(string calldata reason) external {
        revertReason = reason;
    }

    function execTransactionFromModule(address to, uint256 value, bytes memory data, Enum.Operation operation)
        external
        returns (bool success)
    {
        if (bytes(revertReason).length != 0) revert(revertReason);
        callCount++;
        lastTo = to;
        lastValue = value;
        lastData = data;
        lastOperation = operation;
        return shouldSucceed;
    }
}
