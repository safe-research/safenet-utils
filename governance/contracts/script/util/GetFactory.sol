// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Vm} from "@forge-std/Vm.sol";
import {DeterministicDeployment} from "@script/util/DeterministicDeployment.sol";

using DeterministicDeployment for DeterministicDeployment.Factory;

/**
 * @notice Selects the CREATE2 factory a deploy script should use, based on the `FACTORY` environment variable.
 * @dev Vendored from Safenet's own deploy-script utility:
 *      https://github.com/safe-research/safenet/blob/1d8980120859372a8a772ddde708f3b6ea976612/contracts/script/util/GetFactory.sol
 * @param vm The Foundry cheatcode VM.
 * @return The selected CREATE2 factory. Defaults to the Safe singleton factory.
 */
function getFactory(Vm vm) view returns (DeterministicDeployment.Factory) {
    uint256 factoryId = vm.envOr("FACTORY", uint256(1));
    if (factoryId == 1) {
        return DeterministicDeployment.SAFE_SINGLETON_FACTORY;
    } else if (factoryId == 2) {
        return DeterministicDeployment.CANONICAL;
    } else {
        revert("Invalid FACTORY choice");
    }
}
