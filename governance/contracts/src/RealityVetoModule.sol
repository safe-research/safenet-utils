// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

import {IRealityModule} from "@/interfaces/IRealityModule.sol";
import {Enum, ISafe} from "@/interfaces/ISafe.sol";

/**
 * @title RealityVetoModule
 * @notice Safe module granting one immutable address (the vetoer) exactly one capability: making the Safe
 *         invalidate a pending SafeSnap proposal on one immutable Reality module.
 * @dev Stateless by design: `SAFE`, `REALITY_MODULE` and `VETOER` are set once in the constructor and never
 *      change, and `vetoProposal` performs no check beyond the caller. A module bypasses owner signatures,
 *      the threshold and the transaction guard, so this contract's own access control is the whole security
 *      boundary.
 *
 *      See `script/README.md` for the deployment and operations runbook.
 */
contract RealityVetoModule {
    /// @notice The Safe whose authority this module borrows.
    ISafe public immutable SAFE;

    /// @notice The only Reality module this may act on.
    address public immutable REALITY_MODULE;

    /// @notice The only address permitted to call `vetoProposal`.
    address public immutable VETOER;

    /// @notice Thrown when `vetoProposal` is called by anyone other than `VETOER`.
    error NotVetoer();

    /// @notice Thrown when the Safe reports that the invalidation call failed.
    error VetoFailed();

    /// @notice Emitted on every successful veto.
    event ProposalVetoed(bytes32 indexed questionHash);

    constructor(ISafe safe, address realityModule, address vetoer) {
        SAFE = safe;
        REALITY_MODULE = realityModule;
        VETOER = vetoer;
    }

    /**
     * @notice Permanently invalidates the proposal identified by `questionHash`, blocking every transaction
     *         it has not yet executed.
     * @param questionHash Question hash of the proposal to invalidate, as tracked by the Reality module.
     */
    function vetoProposal(bytes32 questionHash) external {
        require(msg.sender == VETOER, NotVetoer());

        bytes memory data = abi.encodeCall(IRealityModule.markProposalAsInvalidByHash, (questionHash));
        require(SAFE.execTransactionFromModule(REALITY_MODULE, 0, data, Enum.Operation.Call), VetoFailed());

        emit ProposalVetoed(questionHash);
    }
}
