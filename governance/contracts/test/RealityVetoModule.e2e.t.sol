// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.30;

import {Test} from "@forge-std/Test.sol";
import {ISafe as IModuleSafe} from "@/interfaces/ISafe.sol";
import {RealityVetoModule} from "@/RealityVetoModule.sol";
import {Enum} from "@safe/common/Enum.sol";
import {GnosisSafe as Safe} from "@safe/GnosisSafe.sol";
import {GnosisSafeProxyFactory as SafeProxyFactory} from "@safe/proxies/GnosisSafeProxyFactory.sol";
import {RealityModuleETH} from "@reality-module/RealityModuleETH.sol";
import {MockERC20} from "@test/util/MockERC20.sol";
import {MockRealitio} from "@test/util/MockRealitio.sol";
import {RealityModuleDeployer} from "@test/util/RealityModuleDeployer.sol";

/**
 * @title RealityVetoModuleE2ETest
 * @notice End-to-end tests for `RealityVetoModule`: a real Safe, a real `RealityModuleETH` v2.0.0 over a
 *         mock Realitio oracle, both enabled on the Safe via real signed `execTransaction` calls. Every
 *         veto here travels the real path `vetoer -> veto module -> Safe -> Reality module`.
 * @dev Covers what only a real Safe and Reality module can prove: a veto blocks real proposal execution,
 *      and the real failure semantics of `execTransactionFromModule`. The module's own call encoding,
 *      gating logic, ABI and bytecode are unit-tested against `MockSafe` in
 *      `test/RealityVetoModule.t.sol`. Neither suite tests `RealityModuleETH`'s or the Safe's own
 *      access control -- that's zodiac-module-reality's and safe-smart-account's code, not this repo's.
 *
 *      The Safe here is 1.3.0, not production's 1.4.1: the version zodiac v1.0.1 and zodiac-module-reality
 *      v2.0.0 were actually written against (see foundry.toml). The `GS104` revert string this suite
 *      asserts on is unchanged across 1.3.0/1.4.1/1.5.0 (docs/error_codes.md).
 */
contract RealityVetoModuleE2ETest is Test {
    // ============================================================
    // CONSTANTS
    // ============================================================

    /// @dev Reality module parameters, matching the SafeDAO Gnosis Chain deployment.
    uint32 public constant QUESTION_TIMEOUT = 3 days;
    uint32 public constant QUESTION_COOLDOWN = 5 days;
    uint32 public constant ANSWER_EXPIRATION = 7 days;
    uint256 public constant MINIMUM_BOND = 1000 ether;
    uint256 public constant TEMPLATE_ID = 166;

    /// @dev Realitio answer meaning "proposal accepted".
    bytes32 public constant ANSWER_YES = bytes32(uint256(1));

    /// @dev Address the Reality module fixture is placed at. See `RealityModuleDeployer`.
    address public constant REALITY_MODULE_ADDRESS = address(uint160(uint256(keccak256("RealityModuleETH fixture"))));

    string public constant PROPOSAL_ID = "QmSnapshotProposalHash";

    // ============================================================
    // FIXTURE
    // ============================================================

    Safe public singleton;
    SafeProxyFactory public factory;
    Safe public safe;
    uint256 public ownerKey;

    MockRealitio public oracle;
    RealityModuleETH public realityModule;
    RealityVetoModule public module;
    MockERC20 public token;

    address public vetoer = address(0x5EF);
    address public recipient = address(0xB0B);

    function setUp() public {
        // Realistic timestamp: the Reality module casts finalization timestamps to `uint32`.
        vm.warp(1_700_000_000);

        ownerKey = 0xA11CE;
        singleton = new Safe();
        factory = new SafeProxyFactory();
        safe = _newSafe(0);

        oracle = new MockRealitio();
        token = new MockERC20();

        realityModule = RealityModuleDeployer.deploy(
            REALITY_MODULE_ADDRESS,
            address(safe),
            address(safe),
            address(safe),
            oracle,
            QUESTION_TIMEOUT,
            QUESTION_COOLDOWN,
            ANSWER_EXPIRATION,
            MINIMUM_BOND,
            TEMPLATE_ID,
            address(safe)
        );

        module = new RealityVetoModule(IModuleSafe(payable(address(safe))), address(realityModule), vetoer);

        // Both modules are enabled the way governance would enable them: a real signed Safe transaction.
        _execSafeTx(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(realityModule)));
        _execSafeTx(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(module)));
    }

    // ============================================================
    // HELPERS: SAFE
    // ============================================================

    /// @dev Deploys a Safe proxy owned by `ownerKey` with a threshold of one.
    function _newSafe(uint256 saltNonce) internal returns (Safe) {
        address[] memory owners = new address[](1);
        owners[0] = vm.addr(ownerKey);
        bytes memory initializer = abi.encodeCall(
            Safe.setup, (owners, 1, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        return Safe(payable(address(factory.createProxyWithNonce(address(singleton), initializer, saltNonce))));
    }

    /// @dev Signs a Safe transaction at the Safe's current nonce with a real ECDSA owner signature. Split out
    ///      from `_execSafeTx` so a test can put `vm.expectRevert` immediately before `execTransaction` rather
    ///      than in front of the signing calls.
    function _signSafeTx(Safe target, address to, uint256 value, bytes memory data)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, _safeTxHash(target, to, value, data));
        return abi.encodePacked(r, s, v);
    }

    /// @dev The Safe EIP-712 transaction hash at the Safe's current nonce, for a plain `Call` with no gas
    ///      refund parameters.
    function _safeTxHash(Safe target, address to, uint256 value, bytes memory data) internal view returns (bytes32) {
        return target.getTransactionHash(
            to, value, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), target.nonce()
        );
    }

    /// @dev Executes a Safe transaction with a real ECDSA owner signature. With `safeTxGas` and `gasPrice`
    ///      both zero, the Safe itself reverts `GS013` if the inner call fails, so every use here is a
    ///      transaction expected to succeed; no test wraps this call in `vm.expectRevert`.
    function _execSafeTx(Safe target, address to, uint256 value, bytes memory data) internal {
        bytes memory signature = _signSafeTx(target, to, value, data);
        target.execTransaction(
            to, value, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signature
        );
    }

    // ============================================================
    // HELPERS: PROPOSALS
    // ============================================================

    /// @dev The Reality question hash identifying a proposal, computed the same way the Reality module and
    ///      the runbook do: `keccak256` of `buildQuestion(proposalId, txHashes)`.
    function _questionHash(string memory proposalId, bytes32[] memory txHashes) internal view returns (bytes32) {
        return keccak256(bytes(realityModule.buildQuestion(proposalId, txHashes)));
    }

    /// @dev Calldata for proposal transaction `index`: mint tokens to `recipient`, so execution is visible.
    function _proposalTxData(uint256 index) internal view returns (bytes memory) {
        return abi.encodeCall(MockERC20.mint, (recipient, (index + 1) * 1 ether));
    }

    /// @dev EIP-712 transaction hashes for a `count`-transaction proposal.
    function _proposalTxHashes(uint256 count) internal view returns (bytes32[] memory txHashes) {
        txHashes = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            txHashes[i] =
                realityModule.getTransactionHash(address(token), 0, _proposalTxData(i), Enum.Operation.Call, i);
        }
    }

    /// @dev Answers a proposal's question "yes" with a sufficient bond, finalized now. Split out from
    ///      `_addAndApproveProposal` so a test can approve two proposals before warping past the cooldown
    ///      once; warping twice would expire the first answer.
    function _approveProposal(string memory proposalId, bytes32[] memory txHashes) internal {
        bytes32 questionId = realityModule.questionIds(_questionHash(proposalId, txHashes));
        // forge-lint: disable-next-line(unsafe-typecast)
        oracle.setAnswer(questionId, ANSWER_YES, MINIMUM_BOND, uint32(block.timestamp));
    }

    /// @dev Adds a proposal, answers its question "yes" with a sufficient bond, and waits out the cooldown.
    ///      After this the proposal is executable, which is the state a veto has to act in.
    function _addAndApproveProposal(string memory proposalId, uint256 txCount)
        internal
        returns (bytes32[] memory txHashes)
    {
        txHashes = _proposalTxHashes(txCount);
        realityModule.addProposal(proposalId, txHashes);
        _approveProposal(proposalId, txHashes);
        vm.warp(block.timestamp + QUESTION_COOLDOWN + 1);
    }

    /// @dev Executes one transaction of a proposal through the Reality module.
    function _executeIndex(string memory proposalId, bytes32[] memory txHashes, uint256 index) internal {
        realityModule.executeProposalWithIndex(
            proposalId, txHashes, address(token), 0, _proposalTxData(index), Enum.Operation.Call, index
        );
    }

    // ============================================================
    // VETO BLOCKS REAL EXECUTION
    // ============================================================

    /// @dev The headline case, told end to end: the veto marks the question invalidated and emits, then
    ///      blocks every transaction of a multi-transaction proposal from executing. The control proposal
    ///      carries the assertion's weight: RealityModule v2.0.0 checks invalidation before the answer,
    ///      bond, cooldown and expiration checks, so a revert on the vetoed proposal alone would also be
    ///      produced by a fixture that was never executable to begin with. The control is identical apart
    ///      from its id and is not vetoed, so it has to execute.
    function test_VetoProposal_MarksInvalidatedEmitsAndBlocksExecution() public {
        string memory controlId = "QmControlProposal";
        bytes32[] memory txHashes = _proposalTxHashes(3);
        realityModule.addProposal(PROPOSAL_ID, txHashes);
        realityModule.addProposal(controlId, txHashes);
        _approveProposal(PROPOSAL_ID, txHashes);
        _approveProposal(controlId, txHashes);
        vm.warp(block.timestamp + QUESTION_COOLDOWN + 1);

        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);
        assertTrue(realityModule.questionIds(questionHash) != realityModule.INVALIDATED());

        vm.expectEmit(true, false, false, false, address(module));
        emit RealityVetoModule.ProposalVetoed(questionHash);
        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        assertEq(realityModule.questionIds(questionHash), realityModule.INVALIDATED());

        for (uint256 i = 0; i < 3; i++) {
            vm.expectRevert("Proposal has been invalidated");
            _executeIndex(PROPOSAL_ID, txHashes, i);
        }
        assertEq(token.balanceOf(recipient), 0);

        // Positive control: the veto blocked this proposal, not the fixture.
        realityModule.executeProposal(controlId, txHashes, address(token), 0, _proposalTxData(0), Enum.Operation.Call);
        assertEq(token.balanceOf(recipient), 1 ether, "the control proposal was not executable either");
    }

    /// @dev The half-applied hazard the runbook has to state: the veto window is per transaction, and a late
    ///      veto blocks the remainder without undoing what already ran.
    function test_VetoProposal_AfterPartialExecutionBlocksRemainingIndices() public {
        bytes32[] memory txHashes = _addAndApproveProposal(PROPOSAL_ID, 3);
        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);

        _executeIndex(PROPOSAL_ID, txHashes, 0);
        _executeIndex(PROPOSAL_ID, txHashes, 1);
        assertEq(token.balanceOf(recipient), 3 ether);

        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        vm.expectRevert("Proposal has been invalidated");
        _executeIndex(PROPOSAL_ID, txHashes, 2);

        assertTrue(realityModule.executedProposalTransactions(questionHash, txHashes[0]));
        assertTrue(realityModule.executedProposalTransactions(questionHash, txHashes[1]));
        assertFalse(realityModule.executedProposalTransactions(questionHash, txHashes[2]));
        assertEq(token.balanceOf(recipient), 3 ether);
    }

    function test_VetoProposal_AfterFullExecutionDoesNotUndo() public {
        bytes32[] memory txHashes = _addAndApproveProposal(PROPOSAL_ID, 2);
        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);

        _executeIndex(PROPOSAL_ID, txHashes, 0);
        _executeIndex(PROPOSAL_ID, txHashes, 1);
        assertEq(token.balanceOf(recipient), 3 ether);

        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        assertEq(realityModule.questionIds(questionHash), realityModule.INVALIDATED());
        assertTrue(realityModule.executedProposalTransactions(questionHash, txHashes[0]));
        assertTrue(realityModule.executedProposalTransactions(questionHash, txHashes[1]));
        assertEq(token.balanceOf(recipient), 3 ether);
    }

    /// @dev The module performs no existence check: a veto can land on a question hash before `addProposal`
    ///      is ever called, pre-emptively blocking that exact identity from ever being proposed. This is a
    ///      deliberate consequence of the reduced scope ("no additional checks"), not a bug.
    function test_VetoProposal_PreemptivelyBlocksAQuestionHashBeforeItIsProposed() public {
        bytes32[] memory txHashes = _proposalTxHashes(1);
        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);
        assertEq(realityModule.questionIds(questionHash), bytes32(0));

        vm.prank(vetoer);
        module.vetoProposal(questionHash);
        assertEq(realityModule.questionIds(questionHash), realityModule.INVALIDATED());

        vm.expectRevert("This proposal has been marked as invalid");
        realityModule.addProposalWithNonce(PROPOSAL_ID, txHashes, 1);
    }

    /// @dev `INVALIDATED` is non-zero, so a repeat veto passes and emits again. The event stream can
    ///      therefore hold duplicates for one question hash; the runbook says so.
    function test_VetoProposal_DoubleVetoIsIdempotentAndReEmits() public {
        bytes32[] memory txHashes = _addAndApproveProposal(PROPOSAL_ID, 1);
        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);

        vm.prank(vetoer);
        module.vetoProposal(questionHash);
        assertEq(realityModule.questionIds(questionHash), realityModule.INVALIDATED());

        vm.expectEmit(true, false, false, false, address(module));
        emit RealityVetoModule.ProposalVetoed(questionHash);
        vm.prank(vetoer);
        module.vetoProposal(questionHash);

        assertEq(realityModule.questionIds(questionHash), realityModule.INVALIDATED());
    }

    // ============================================================
    // FAILURE MODES
    // ============================================================

    /// @dev Safe's module path does not bubble the inner revert, it returns `false`, so "inner call reverts"
    ///      and "inner call returns false" are the same event at this boundary and both surface as
    ///      `VetoFailed`.
    function test_VetoProposal_RevertsVetoFailedAndMutatesNothingWhenRealityModuleOwnedByOtherSafe() public {
        bytes32[] memory txHashes = _addAndApproveProposal(PROPOSAL_ID, 1);
        bytes32 questionHash = _questionHash(PROPOSAL_ID, txHashes);
        bytes32 questionIdBefore = realityModule.questionIds(questionHash);

        Safe otherSafe = _newSafe(2);
        _execSafeTx(
            safe, address(realityModule), 0, abi.encodeWithSignature("transferOwnership(address)", address(otherSafe))
        );
        assertEq(realityModule.owner(), address(otherSafe));
        vm.deal(address(safe), 4 ether);
        uint256 safeNonceBefore = safe.nonce();

        vm.recordLogs();
        vm.prank(vetoer);
        vm.expectRevert(RealityVetoModule.VetoFailed.selector);
        module.vetoProposal(questionHash);

        assertEq(realityModule.questionIds(questionHash), questionIdBefore);
        assertEq(address(safe).balance, 4 ether);
        assertEq(safe.nonce(), safeNonceBefore);
    }
}
