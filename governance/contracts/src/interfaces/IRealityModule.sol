// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

/**
 * @title Reality Module Interface (partial)
 * @notice The single Reality module entry point `RealityVetoModule` depends on.
 * @dev Vendored slice of zodiac-module-reality's `RealityModule`, kept to just the owner-gated invalidation
 *      function so this package has no dependency on the full zodiac-module-reality contracts:
 *      https://github.com/gnosisguild/zodiac-module-reality/blob/main/contracts/RealityModule.sol#L280-L284
 */
interface IRealityModule {
    /**
     * @notice Marks a question hash as invalid, permanently preventing execution of its proposal.
     * @dev Callable only by the module's owner, expected to be the Safe this module acts through.
     * @param questionHash Question hash calculated based on the proposal id and transaction hashes.
     */
    function markProposalAsInvalidByHash(bytes32 questionHash) external;
}
