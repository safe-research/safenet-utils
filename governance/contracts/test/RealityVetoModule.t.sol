// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

import {Test} from "@forge-std/Test.sol";
import {IRealityModule} from "@/interfaces/IRealityModule.sol";
import {Enum, ISafe} from "@/interfaces/ISafe.sol";
import {RealityVetoModule} from "@/RealityVetoModule.sol";
import {MockSafe} from "@test/util/MockSafe.sol";

/**
 * @title RealityVetoModuleTest
 * @notice Unit tests for `RealityVetoModule` in isolation: a `MockSafe` test double stands in for `SAFE`, so
 *         every test here is about the module's own logic (call encoding, the vetoer gate, error mapping,
 *         its selector dispatch, its bytecode) and never depends on a real Safe or a real Reality module.
 *         See `test/RealityVetoModule.e2e.t.sol` for behaviour that only a real integration can prove.
 */
contract RealityVetoModuleTest is Test {
    MockSafe public safe;
    RealityVetoModule public module;

    address public realityModule = address(0xBEEF);
    address public vetoer = address(0x5EF);
    address public attacker = address(0xBAD);

    function setUp() public {
        safe = new MockSafe();
        module = new RealityVetoModule(ISafe(payable(address(safe))), realityModule, vetoer);
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    function test_Constructor_SetsImmutables() public view {
        assertEq(address(module.SAFE()), address(safe));
        assertEq(module.REALITY_MODULE(), realityModule);
        assertEq(module.VETOER(), vetoer);
    }

    /// @dev Documents the reduced scope: the constructor performs no validation at all, unlike a design with
    ///      a rotatable owner. A zero-address `safe`, `realityModule` or `vetoer` deploys cleanly.
    function test_Constructor_AcceptsZeroAddressesWithNoValidation() public {
        RealityVetoModule zeroSafe = new RealityVetoModule(ISafe(payable(address(0))), realityModule, vetoer);
        assertEq(address(zeroSafe.SAFE()), address(0));

        RealityVetoModule zeroRealityModule = new RealityVetoModule(ISafe(payable(address(safe))), address(0), vetoer);
        assertEq(zeroRealityModule.REALITY_MODULE(), address(0));

        RealityVetoModule zeroVetoer = new RealityVetoModule(ISafe(payable(address(safe))), realityModule, address(0));
        assertEq(zeroVetoer.VETOER(), address(0));
    }

    // ============================================================
    // VETOPROPOSAL: THE CALL IT MAKES
    // ============================================================

    /// @dev The Safe only ever sees `execTransactionFromModule(REALITY_MODULE, 0,
    ///      markProposalAsInvalidByHash(questionHash), Call)`, encoded exactly.
    function test_VetoProposal_CallsSafeWithExpectedArgs() public {
        bytes32 questionHash = keccak256("a proposal");

        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        assertEq(safe.callCount(), 1);
        assertEq(safe.lastTo(), realityModule);
        assertEq(safe.lastValue(), 0);
        assertEq(safe.lastData(), abi.encodeCall(IRealityModule.markProposalAsInvalidByHash, (questionHash)));
        assertTrue(safe.lastOperation() == Enum.Operation.Call);
    }

    function test_VetoProposal_EmitsProposalVetoedOnSuccess() public {
        bytes32 questionHash = keccak256("a proposal");

        vm.expectEmit(true, false, false, false, address(module));
        emit RealityVetoModule.ProposalVetoed(questionHash);
        vm.prank(vetoer);
        module.vetoProposal(questionHash);
    }

    /// @dev A revert unwinds every nested state change, including `MockSafe`'s own bookkeeping, so
    ///      `callCount` can't be inspected after the fact here. `vm.expectCall` instead proves the module
    ///      did reach the Safe before reverting, rather than short-circuiting beforehand.
    function test_VetoProposal_RevertsVetoFailedWhenSafeCallReturnsFalse() public {
        safe.setShouldSucceed(false);
        bytes32 questionHash = keccak256("a proposal");

        vm.expectCall(
            address(safe),
            abi.encodeCall(
                ISafe.execTransactionFromModule,
                (
                    realityModule,
                    0,
                    abi.encodeCall(IRealityModule.markProposalAsInvalidByHash, (questionHash)),
                    Enum.Operation.Call
                )
            )
        );
        vm.prank(vetoer);
        vm.expectRevert(RealityVetoModule.VetoFailed.selector);
        module.vetoProposal(questionHash);
    }

    /// @dev `require(SAFE.execTransactionFromModule(...), VetoFailed())` only turns a `false` return into
    ///      `VetoFailed`. It does not catch a revert from that call, e.g. a real Safe's `GS104` for a caller
    ///      that is not (or is no longer) an enabled module, or `GS031`-style guards elsewhere; such a
    ///      revert propagates unchanged, never reaching the `require` at all.
    function test_VetoProposal_PropagatesSafeRevertUnwrapped() public {
        safe.setRevertReason("GS104");

        vm.prank(vetoer);
        vm.expectRevert(bytes("GS104"));
        module.vetoProposal(keccak256("a proposal"));
    }

    /// @dev The module performs no existence or shape check of its own: any `bytes32` the vetoer supplies is
    ///      forwarded verbatim, matching the reduced design's "no additional checks".
    function testFuzz_VetoProposal_ForwardsAnyQuestionHash(bytes32 questionHash) public {
        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        assertEq(safe.lastData(), abi.encodeCall(IRealityModule.markProposalAsInvalidByHash, (questionHash)));
    }

    // ============================================================
    // VETOPROPOSAL: WHO MAY CALL IT
    // ============================================================

    /// @dev Invariant over the callers that matter, rather than the fuzzer's uniform distribution: the zero
    ///      address, the module's own configured Safe, the Reality module address, the module itself, and
    ///      an arbitrary contract, none of which is ever the vetoer.
    function test_VetoProposal_RevertsForNamedNonVetoers() public {
        address[5] memory callers = [address(0), address(safe), realityModule, address(module), address(this)];

        for (uint256 i = 0; i < callers.length; i++) {
            assertTrue(callers[i] != vetoer);
            vm.prank(callers[i]);
            vm.expectRevert(RealityVetoModule.NotVetoer.selector);
            module.vetoProposal(keccak256("a proposal"));
        }
    }

    /// @dev Supplements the named table above; it does not replace it.
    function testFuzz_VetoProposal_RevertsForNonVetoer(address caller) public {
        vm.assume(caller != vetoer);

        vm.prank(caller);
        vm.expectRevert(RealityVetoModule.NotVetoer.selector);
        module.vetoProposal(keccak256("a proposal"));
    }

    function test_VetoProposal_RejectedForNonVetoerNeverCallsSafe() public {
        vm.prank(attacker);
        (bool ok,) = address(module).call(abi.encodeCall(RealityVetoModule.vetoProposal, (keccak256("a proposal"))));

        assertFalse(ok);
        assertEq(safe.callCount(), 0, "a rejected veto reached the Safe");
    }

    // ============================================================
    // ABI AND RAW CALL INVARIANTS
    // ============================================================

    /// @dev The invariant that matters: whatever selector a call carries, if it is not one of the module's
    ///      four (`vetoProposal` plus the three immutable getters), it must not dispatch.
    function testFuzz_Abi_UnknownSelectorIsNeverDispatched(bytes4 selector, bytes calldata payload) public {
        vm.assume(
            selector != RealityVetoModule.vetoProposal.selector && selector != module.SAFE.selector
                && selector != module.REALITY_MODULE.selector && selector != module.VETOER.selector
        );

        (bool ok, bytes memory ret) = address(module).call(abi.encodePacked(selector, payload));

        assertFalse(ok, "veto module dispatched an unknown selector");
        assertEq(ret.length, 0, "veto module has a function for this selector");
    }

    /// @dev The module has no `receive`/`fallback`, which the selector-dispatch invariant above cannot
    ///      cover: an empty-calldata call carries no selector at all to be "unknown".
    function test_RawCall_EtherTransferReverts() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(module).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(module).balance, 0);
    }

    // ============================================================
    // BYTECODE INVARIANT
    // ============================================================

    /// @dev Walks the deployed runtime code opcode by opcode and rejects `CREATE`, `CALLCODE`,
    ///      `DELEGATECALL`, `CREATE2` and `SELFDESTRUCT`. A plain byte search would false-positive on `PUSH`
    ///      data, so the walk skips immediates, and solc's CBOR metadata trailer is stripped for the same
    ///      reason.
    function test_Bytecode_ContainsNoDelegatecallCreateOrSelfdestruct() public view {
        bytes memory code = address(module).code;
        uint256 end = _runtimeCodeEnd(code);
        assertGt(end, 0);

        for (uint256 i = 0; i < end;) {
            uint8 opcode = uint8(code[i]);
            assertTrue(opcode != 0xf0, "CREATE in runtime code");
            assertTrue(opcode != 0xf2, "CALLCODE in runtime code");
            assertTrue(opcode != 0xf4, "DELEGATECALL in runtime code");
            assertTrue(opcode != 0xf5, "CREATE2 in runtime code");
            assertTrue(opcode != 0xff, "SELFDESTRUCT in runtime code");
            // PUSH1..PUSH32 carry 1..32 immediate bytes; PUSH0 (0x5f) carries none.
            i += (opcode >= 0x60 && opcode <= 0x7f) ? uint256(opcode) - 0x5e : 1;
        }
    }

    /// @dev Offset of the end of executable code, which is where solc's CBOR metadata trailer starts. The
    ///      trailer's last two bytes are its own length. Returns the full length if that does not parse.
    function _runtimeCodeEnd(bytes memory code) internal pure returns (uint256) {
        if (code.length < 2) return code.length;
        uint256 metadataLength = (uint256(uint8(code[code.length - 2])) << 8) | uint256(uint8(code[code.length - 1]));
        if (metadataLength + 2 > code.length) return code.length;
        return code.length - 2 - metadataLength;
    }
}
