# Deploy Scripts

## Reality Veto Module

Deploys and operates [`RealityVetoModule`](../src/RealityVetoModule.sol), the SafeDAO module that lets one
immutable address (the vetoer) make the Safe invalidate a pending SafeSnap proposal. Read the contract's own
NatSpec first: it holds the threat model and the invariants this runbook assumes — in particular, `SAFE`,
`REALITY_MODULE` and `VETOER` are all immutable, so there is no rotation or reconfiguration path short of
deploying a new module.

Enabling a module on the SafeDAO Safe is a governance transaction. Everything below the deployment step is
executed by SafeDAO owners, not by whoever runs the script.

### Configuration

Set these in `governance/contracts/.env`; `.env.sample` has the block. All three are Gnosis Chain addresses.

| Variable                      | What it is                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `VETO_SAFE_ADDRESS`           | The SafeDAO Safe that will enable this module, and that owns the Reality module.                     |
| `VETO_REALITY_MODULE_ADDRESS` | The SafeSnap Reality module proxy owned by that Safe.                                                |
| `VETOER_ADDRESS`              | The account permitted to veto. Still an open governance decision, so do not broadcast until settled. |

### Before deploying

Check that the Safe still owns the Reality module. A swapped or stale `VETO_REALITY_MODULE_ADDRESS` otherwise
survives deployment, survives the governance vote, and only shows up as a `VetoFailed` at the first real veto:

```
cast call $VETO_REALITY_MODULE_ADDRESS "owner()(address)" --rpc-url $RPC_URL   # must equal VETO_SAFE_ADDRESS
cast call $VETO_REALITY_MODULE_ADDRESS "avatar()(address)" --rpc-url $RPC_URL  # must equal VETO_SAFE_ADDRESS
cast call $VETO_REALITY_MODULE_ADDRESS "target()(address)" --rpc-url $RPC_URL  # must equal VETO_SAFE_ADDRESS
```

The constructor checks addresses, not code or ownership, so this is the only place these are caught early.

### Deployment

Dry run:

```
just contracts-deploy-reality-veto
```

Broadcast:

```
just contracts-deploy-reality-veto --rpc-url $RPC_URL --broadcast --sender SENDER_ADDRESS --account gnosis-account
```

The deployed address is in the script output (`RealityVetoModule deployed at: 0x...`). Record it alongside the
other deployment addresses and verify the contract on Gnosisscan. The module does nothing at all until the Safe
enables it.

### Enabling the module

One transaction from the SafeDAO Safe, at the full owner threshold. In the Safe Tx Builder:

- To: the SafeDAO Safe itself (`$VETO_SAFE_ADDRESS`)
- Value: `0`
- Operation: `Call`
- Function: `enableModule(address module)`, with `module` set to the deployed `RealityVetoModule`

Raw calldata is `0x610b5925` followed by the module address left-padded to 32 bytes.

### After enabling

1. `cast call $VETO_SAFE_ADDRESS "isModuleEnabled(address)(bool)" $VETO_MODULE --rpc-url $RPC_URL` must return
   `true`.
2. `cast call $VETO_MODULE "VETOER()(address)" --rpc-url $RPC_URL` must return the intended vetoer, and
   `SAFE()(address)` / `REALITY_MODULE()(address)` the addresses above.
3. Smoke-test a real veto on a fork, not on chain. Fork Gnosis at the current block
   (`anvil --fork-url $RPC_URL`), add a throwaway proposal through the Reality module (`addProposal(proposalId,
txHashes)`), compute its question hash the same way the module does (see "Vetoing a proposal" below), veto it
   from the vetoer with `vetoProposal(questionHash)`, and check `questionIds(questionHash)` on the Reality module
   now equals its own `INVALIDATED()` constant. A veto that silently does nothing is the failure this catches;
   nothing else does.

### Vetoing a proposal

`RealityVetoModule.vetoProposal` takes the question hash directly, not the proposal id and transaction hashes.
Compute it exactly the way the Reality module does when the proposal is added — `keccak256` of the ASCII string
`buildQuestion(proposalId, txHashes)` returns, not of the id or hashes on their own:

```
QUESTION=$(cast call $VETO_REALITY_MODULE_ADDRESS "buildQuestion(string,bytes32[])(string)" "$PROPOSAL_ID" "[$TX_HASHES]" --rpc-url $RPC_URL)
QUESTION_HASH=$(cast keccak "$QUESTION")
cast send $VETO_MODULE "vetoProposal(bytes32)" $QUESTION_HASH --rpc-url $RPC_URL
```

The `$PROPOSAL_ID` and `$TX_HASHES` must be exactly those the proposal was, or will be, added with — a different
value at either produces a different hash and vetoes nothing.

Four things to know before pressing send:

- **A veto is permanent for that question hash** and cannot be undone by anyone, including by re-adding the same
  `proposalId`/`txHashes` pair — the Reality module refuses to accept a proposal whose hash is already invalidated.
  Governance can re-propose under a new `proposalId`, which restarts the timeout and cooldown.
- **The Reality module does not check that a proposal exists at that hash before invalidating it.** Vetoing ahead
  of `addProposal` is valid and pre-emptively blocks that exact `proposalId`/`txHashes` pair from ever being
  proposed; there is no "not found" revert to worry about.
- **A late veto can leave a multi-transaction proposal half-applied.** Execution is one call per transaction and
  each re-reads the invalidation flag, so a veto after index `k` blocks `k+1` onward and does not undo `0..k`.
  Check how far execution has progressed (`executedProposalTransactions`) before vetoing a multi-transaction
  proposal, and prepare the remediation transaction alongside the veto.
- **A repeat veto succeeds and re-emits.** `ProposalVetoed` can legitimately appear twice for one question hash.

### Monitoring

Watch `ProposalQuestionCreated` on the Reality module and `ProposalVetoed` on the veto module.

`VETOER`, `SAFE` and `REALITY_MODULE` are immutable, so unlike a rotatable-vetoer design there is no in-module
call that neutralises the veto. The one neutralisation vector is a passed proposal whose transactions target the
Safe's own module list (`disableModule`): the Reality module calls through the Safe, so such a proposal arrives at
`disableModule` with `msg.sender == the Safe` and passes the Safe's own auth check. The only defence is vetoing
that proposal inside its own window, so monitoring must flag proposals by what their `txHashes` touch, not only by
what they appear to be about.

### Changing the vetoer

There is no `setVetoer`; `VETOER` is immutable. Changing it means deploying a new `RealityVetoModule` with the new
vetoer (same deployment steps above) and swapping modules on the Safe: enable the new module, then disable the old
one (see "Emergency revocation" below). Until the old module is disabled, both vetoers are live.

### Emergency revocation

`disableModule(address prevModule, address module)` from the Safe, on the Safe. Read the module list first, because
`prevModule` is the entry preceding the veto module in the Safe's linked list:

```
cast call $VETO_SAFE_ADDRESS "getModulesPaginated(address,uint256)(address[],address)" 0x0000000000000000000000000000000000000001 100 --rpc-url $RPC_URL
```

`prevModule` is `0x...01` (the sentinel) when the veto module is at the head of the list, which it is unless
another module was enabled after it. Disabling leaves the Reality module untouched and makes every subsequent
`vetoProposal` revert `GS104`.

### Fallback if the module is disabled

The Safe can still invalidate a proposal without the module, by owner-signed `execTransaction` calling
`markProposalAsInvalid(string,bytes32[])` on the Reality module directly. Same effect, at the full owner
threshold, which is the latency the module exists to avoid.

### Ether sent to the module

The module has no `receive` and no `fallback`, so it cannot be paid by a normal transfer, but ether can still be
forced in (a `selfdestruct` beneficiary, or a block reward). Such a balance is stuck: the module has no function
that moves value. It is not Safe funds and needs no action.
