// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

/**
 * @title Enum - Collection of enums used in Safe contracts.
 * @dev Vendored from Safe's Enum.sol:
 *      https://github.com/safe-global/safe-smart-account/blob/main/contracts/interfaces/Enum.sol
 * @author Richard Meissner - @rmeissner
 */
contract Enum {
    enum Operation {
        Call,
        DelegateCall
    }
}

/**
 * @title Safe Interface (partial)
 * @notice The single Safe entry point `RealityVetoModule` depends on.
 * @dev Vendored slice of Safe's ISafe interface, kept to just the module-execution function so this package
 *      has no dependency on the full safe-smart-account contracts:
 *      https://github.com/safe-global/safe-smart-account/blob/main/contracts/interfaces/IModuleManager.sol
 */
interface ISafe {
    /**
     * @notice Executes a transaction on behalf of the Safe from an enabled module, without owner signatures.
     * @dev Returns `false` rather than bubbling up the inner revert reason on failure.
     * @param to Destination address of the transaction.
     * @param value Native token value of the transaction.
     * @param data Data payload of the transaction.
     * @param operation Operation type (`Call` or `DelegateCall`).
     * @return success Whether the transaction was successful.
     */
    function execTransactionFromModule(address to, uint256 value, bytes memory data, Enum.Operation operation)
        external
        returns (bool success);
}
