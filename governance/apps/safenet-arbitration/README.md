# Safenet Arbitration Safe App

A [Safe App](https://github.com/safe-global/safe-apps-sdk) for the Safe that holds a `SentinelOracle`'s
`ARBITRATOR` role. It lists disputed (`FROZEN`) requests and proposes rulings through Safe Wallet.
Owners must confirm and execute each proposal in the normal multisig flow.

The app uses the Safe Apps SDK for current chain state and proposals. An optional custom RPC supplies historical logs.
It has no standalone wallet connector, indexer, database, or backend.
It accepts SDK messages only from `https://app.safe.global`. No contract changes are required.

## Configuration

Build-time Vite variables select one oracle. See [`.env.sample`](./.env.sample).

| Default           | Value                                        |
| ----------------- | -------------------------------------------- |
| Chain             | Gnosis mainnet, chain ID `100`               |
| Sentinel oracle   | `0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0` |
| Deployment block  | `48280806`                                   |
| Maximum log range | `10000` blocks                               |

The default deployment uses a mock fee token. It predates some fixes in the current protocol source.
The app uses its compatible dispute, request, proposal, commitment, and reveal interfaces.
Do not assume that this deployment contains all current contract fixes.

Set `VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK` explicitly for a different chain or oracle.
The value must be a nonnegative safe integer. The app does not reuse the default deployment block for custom targets.

## Search settings

Open **Search settings** to change the discovery window or log provider.

- **Lookback blocks** defaults to `10000`. Enter a positive whole number, or clear the field for full deployment history.
- The window ends at the current head and advances on refresh. Older disputes can fall outside it.
- A selected case that leaves the window stays visible until closed. Its proposal feedback remains visible, but new rulings are disabled.
- The original proposal and sentinel evidence can predate the discovery window. Their reads are not limited by the lookback.
- **Custom RPC URL** is optional. Clear it to restore Wallet log reads.
- A custom RPC must serve the configured chain and permit browser requests through CORS.
- Use HTTPS, or HTTP for a loopback endpoint. Embedded credentials and URL fragments are rejected.

The app checks the custom RPC's chain before it applies settings. Failed validation preserves the active case and rationale.
Settings changes are blocked while a proposal is pending. Settings and URLs remain in tab memory; they are not persisted.
The app does not send the custom URL to Safe services or automatically fall back to another RPC.

Use a trusted log provider with sufficient historical coverage.
A custom RPC does not guarantee archive access, higher rate limits, or complete event data.
Safe Wallet still supplies heads, block hashes, request states, sentinel counts, authorization, simulation, and proposals.

## Discovery and refresh

The app checks the connected chain and reads `ARBITRATOR()` before it shows requests.
A different Safe cannot use the app. A matching read-only Safe can inspect evidence but cannot propose rulings.
The host must explicitly report write access before the app enables any ruling.
The connection refreshes every 30 seconds while visible and when the app returns to visibility.

Discovery starts at the current head and searches older bounded pages within the selected window.
It never searches before the oracle deployment block.
An empty recent page does not mean that no requests exist. The app shows incomplete coverage until discovery finishes.
It checks candidate requests with `getRequest` and retains only `FROZEN` requests, newest trigger first.
Historical pages and request-state batches retain the same pacing with either log provider.
Full-history discovery can take several minutes. Found requests remain visible while older pages load.

One query owns historical discovery and incremental refresh. Visible refresh runs every 30 seconds.
It reads new dispute logs and refreshes retained request states without repeating completed historical searches.
A failed read preserves the last successful rows, marks them stale, and blocks rulings until Retry succeeds.
A chain-history replacement restarts discovery and discards the selected case's cached evidence and form state.
Evidence caches include the log source, lookback, and chain-history generation, so window changes cannot restore orphaned evidence.

`Timeout available` appears only when the observed block exceeds `arbitrationDeadline`.
The deadline does not close a request or prohibit a ruling. An overdue `FROZEN` request inside the selected window
remains actionable until a ruling or permissionless timeout changes its state.

## Evidence

Expand a request to inspect its original transaction and sentinel activity.
The original transaction can belong to a different chain from the arbitration oracle.

The app locates the proposal at `commitDeadline - COMMIT_WINDOW` and verifies both bindings:

- The proposal's request ID matches this oracle, proposer, epoch, oracle data, and Safe transaction hash.
- The full transaction tuple produces the declared Safe EIP-712 transaction hash.

Sentinel evidence covers the proposal block through the dispute-trigger block, inclusive.
It shows each unique commitment or reveal event, including repeated commitments from one sentinel.
Blank reveal reasons have an explicit label. Other reasons remain plain text.
Commitment, reveal, approval, and denial counts must match the on-chain request.
Missing, failed, or inconsistent evidence has a scoped Retry control.

Valid HTTPS explorer metadata links the events' EVM transactions. Without that metadata, hashes remain plain text.
A Safe proposal hash is never treated as an EVM transaction hash.

## Rulings

- **Rule secure** sides with the approving sentinels through `resolveDispute`.
- **Rule insecure** sides with the denying sentinels through `resolveDispute`.
- **Out of scope** declines to rule through `markOutOfScope`.

Secure and insecure rulings require verified transaction evidence and complete sentinel evidence.
Out of scope remains available without that evidence, but the app never selects it automatically.
Every ruling requires a nonblank rationale, recorded on-chain.

Each attempt checks the current Safe, chain, write access, arbitrator role, and `FROZEN` request state.
It simulates the exact zero-value oracle call from the arbitrator Safe, then checks identity and state again.
Only then does it ask Safe Wallet to queue one call. Row changes, ruling changes, Cancel, and duplicate submissions
are blocked while the proposal is pending. A failed attempt preserves the rationale for an explicit retry.

Success means **queued**, not executed. The app shows the full Safe proposal hash and, when metadata is available,
a link to the submitting Safe's queue. The request stays listed until a refresh confirms its closure.
State can still change after preflight or while Safe Wallet is open; simulation does not guarantee execution.

Arbitration settles sentinel consequences. It does not authorize the original transaction or revive its attestation.

## Developing

Use Node `24.15.0` or later within Node 24, and npm 11. From the repository root:

```sh
just deps                        # npm ci
just safenet-arbitration-app-dev # Vite dev server
```

In Safe Wallet, select **Apps → My custom apps → Add custom Safe App** and enter the development URL,
for example `http://localhost:5173`. The server supplies the CORS and frame headers the wallet needs.

`just build`, `just check`, `just fix`, and `just test` cover this package alongside the rest of the repository.
Inside this directory, use `npm run build`, `npm run check`, `npm run fix`, and `npm test`.
CI retains the repository checks and also runs this app's tests and production build.

The tests use deterministic SDK fixtures. Browser verification can use a synthetic Safe parent with local proposal
capture. That verifies the UI and SDK boundary; it does not prove live multisig execution.
