# Epic: Follow-ups

This is the standing backlog for small, self-contained follow-up work that does not warrant its own product epic. Add items as new sections under **Open items** and remove their sections after the work ships. Keep each item focused enough to deliver in one PR, including its acceptance criteria and tests.

---

## Open items

### 1. Gate arbitration actions to the arbitrator Safe

**Problem:** The app currently checks only that the connected Safe is on the configured chain. A different Safe on that chain can therefore queue `resolveDispute` or `markOutOfScope` transactions even though `SentinelOracle` will reject them unless that Safe holds its immutable `ARBITRATOR` role.

**Scope:**

- Read `ARBITRATOR()` from the configured `SentinelOracle` through `sdk.eth.call` after the Safe connection succeeds.
- Compare the returned address with `connection.safe.safeAddress` using normalized, case-insensitive address equality.
- Show the request list and ruling controls only when both the configured chain and arbitrator Safe checks pass.
- Give clear loading, read-error, and mismatched-Safe states. The mismatch state should identify that the app must be opened from the configured oracle's arbitrator Safe.
- Keep the check close to the app entry point so no component can offer a ruling while the role is unverified.

**Acceptance criteria:**

- The arbitrator Safe on the configured chain can see and use the request list and ruling controls.
- A Safe on the configured chain whose address differs from `ARBITRATOR()` cannot queue a ruling transaction.
- The app does not offer rulings while the `ARBITRATOR()` read is loading or has failed.
- Tests cover the matching, mismatched, loading, and error states.

### 2. Disable rulings after the arbitration deadline

**Problem:** A request can remain `FROZEN` after its `arbitrationDeadline` until someone calls `timeoutArbitration`. The app currently still offers ruling controls, but `SentinelOracle` will reject a ruling once that deadline has passed.

**Scope:**

- Read the current block number through the Safe Apps SDK as part of the request data refresh.
- Compare it with each request's `arbitrationDeadline`, using the same boundary condition as `SentinelOracle`'s ruling and timeout functions.
- Do not offer Approve, Deny, or Decline actions for expired requests. Show that arbitration has expired and that the request awaits the permissionless timeout path.
- Ensure a refresh updates the available actions as the chain advances.

**Acceptance criteria:**

- A `FROZEN` request within its arbitration window continues to expose all three ruling actions.
- A `FROZEN` request past the contract's ruling deadline exposes no ruling action and communicates why.
- Boundary tests cover the final block on which a ruling is valid and the first block on which it is rejected.
- Tests use mocked SDK block and request data and do not require a live chain.

---

## Maintenance

- Add future follow-ups as numbered sections under **Open items** with a problem statement, scope, and acceptance criteria.
- Remove a section when its implementation has shipped; this epic intentionally remains in the repository as the reusable follow-up backlog.
