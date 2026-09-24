# Plan: Arbitration Safe App

Component: new `governance/apps/safenet-arbitration/` package (Vite + React + TypeScript Safe App).

---

## Overview

[`SentinelOracle`](https://github.com/safe-research/safenet/blob/0be96367486a9fbd804c702b255fecfb3adbdcb3/contracts/src/SentinelOracle.sol), part of the [Safenet](https://github.com/safe-research/safenet) protocol, gates each proposed Safe transaction ("request") behind a bonded commit-reveal vote from a set of sentinels. Most requests resolve on their own (unanimous approve or deny). When a request's revealed votes split — some sentinels approve, some deny — `finalize` moves it to `FROZEN` and emits `DisputeTriggered`: the request is now **arbitrated**, and only the contract's immutable `ARBITRATOR` address can rule on it via `resolveDispute(requestId, approveWins, context)` (or decline via `markOutOfScope`). If the arbitrator does nothing, anyone can call `timeoutArbitration` once the arbitration deadline passes.

There is currently no tooling for whoever holds `ARBITRATOR` to see which requests are frozen and awaiting a ruling, or to submit that ruling; both require reading raw event logs and hand-building calldata. As with `RealityVetoModule`'s `VETOER`, `ARBITRATOR` is a single address with no on-chain voting logic of its own — the natural way to run it collectively is as a Safe, where each owner's confirmation on a `resolveDispute` (or `markOutOfScope`) transaction is their vote, and Safe{Wallet}'s own threshold/execution flow does the rest.

This epic adds a minimal [Safe App](https://github.com/safe-global/safe-apps-sdk) — loaded inside Safe{Wallet} while connected as the ARBITRATOR Safe — that:

- Lists requests currently `FROZEN` on the configured `SentinelOracle` (the "arbitrated proposals": disputed, not yet ruled on or timed out), each with its sponsor, approve/deny sentinel counts, and arbitration deadline.
- Lets an owner queue a ruling transaction for one of them — `resolveDispute(requestId, approveWins, context)` (Approve or Deny) or `markOutOfScope(requestId, context)` (Decline to rule), each with a short rationale — which Safe{Wallet}'s own UI then collects confirmations for and executes; that confirmation flow is the "voting".

The app talks to chain state exclusively through `@safe-global/safe-apps-sdk` (`sdk.eth.getPastLogs` / `sdk.eth.call` for reads, `sdk.txs.send` for the ruling), so it needs no separate wallet connector or RPC provider — deliberately smaller than [`safenet-staking-ui`](https://github.com/safe-fndn/safenet-staking-ui), which additionally supports external wallets and on-chain writes outside of Safe{Wallet}. Style and repo layout otherwise follow that project's conventions (Vite, TypeScript, Tailwind CSS, `src/` organized by type: `abi/`, `components/`, `config/`, `hooks/`, `lib/`, with tests in `__tests__/` directories).

Steps, each a separate PR:

1. Scaffold the Vite/React/TypeScript app shell with Safe Apps SDK wiring and repo build/lint/test integration, no request logic yet.
2. Read and list `FROZEN` (arbitrated) requests from the configured `SentinelOracle`.
3. Add the ruling ("vote") actions that queue a `resolveDispute` or `markOutOfScope` transaction via the SDK.
4. UI/UX improvements (dark mode, pointer cursors). Deployment is handled outside this repo via Cloudflare.
5. Remove this plan once the epic is complete.

---

## Architecture Decision

New `governance/apps/` directory, sibling to `governance/contracts/`, holding `governance/apps/safenet-arbitration/` — the repo's first frontend package. This is Safenet governance/arbitration tooling specifically (it operates against a `SentinelOracle`, same spirit as `governance/contracts`' veto/guardian modules), so it's grouped under `governance/` by purpose rather than at the repo root; keeping it in its own `apps/` sibling to `contracts/` still keeps the npm and Foundry toolchains from mixing in the same directory.

A plain npm package with its own `package.json`, wired into the root `Justfile` the same way `governance/contracts` is (per `AGENTS.md`): `just build`, `just check`, `just fix`, `just test` each grow a line for this package. The Vite dev server is package-specific (unlike the aggregate `build`/`check`/`fix`/`test` recipes), so it gets its own explicitly-named recipe rather than a generic `app-dev` — `just` recipe names can't contain a literal `:` outside its module system, so this follows the existing `contracts-deploy-reality-veto` hyphenated-prefix convention: `just safenet-arbitration-app-dev`.

The app is intentionally read-through-SDK-only:

- **Reads** (frozen requests and their state) go through `sdk.eth.getPastLogs` (to find `DisputeTriggered` and, to filter out already-settled disputes, `DisputeResolved`/`DisputeOutOfScope`/`ArbitrationTimedOut` on `SentinelOracle`) and `sdk.eth.call` (`getRequest(requestId)`, to confirm current `state`/counts/deadline directly rather than trust log ordering alone). No RPC URL, wagmi/viem _client_, or subgraph dependency — the connected Safe{Wallet} already proxies `eth_call`/`eth_getLogs` for apps loaded in its iframe.
- **Writes** (the ruling) go through `sdk.txs.send({ txs: [...] })`, which hands the transaction to Safe{Wallet}'s own confirmation/execution flow. The app never signs or broadcasts anything itself, and never needs to know the connected Safe's threshold or owners — Safe{Wallet} handles all of that once the transaction is queued.
- **ABI encoding/decoding**: `SentinelOracle` isn't vendored into this repo (unlike `zodiac-module-reality`, which `governance/contracts` depends on as a submodule) and the `safenet` repo publishes no generated ABI/types package to depend on for TypeScript — its own `examples/` package hand-declares the handful of fragments it needs via viem's `parseAbiItem`, the same "vendor just what we use" approach `governance/contracts/src/interfaces/IRealityModule.sol` takes for Solidity. This app follows that precedent: `viem` as a dependency used purely for `parseAbiItem`/`encodeFunctionData`/`decodeFunctionResult` on a small, hand-written set of fragments (`getRequest`, `resolveDispute`, `markOutOfScope`, and the four dispute events), copied from `contracts/src/SentinelOracle.sol` at a pinned commit — not a full viem `PublicClient`/wallet stack, and not a git submodule (there's no generated artifact in `safenet` for one to track).
- `SentinelOracle` address and target chain are build-time config (`.env`/`.env.sample`), mirroring how `governance/contracts/.env.sample` ships real addresses rather than requiring a runtime address picker. Default values point at the current Gnosis Chain (chain ID `100`) testnet deployment, `0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0` — build variables, so pointing at a different deployment (e.g. once a production `SentinelOracle` exists) is a `.env` change, not a code change.

Styling: Tailwind CSS, matching `safenet-staking-ui`. No component library dependency is pulled in for v1 (a request list, three ruling buttons, and a rationale field do not need Radix/shadcn) — revisit if the UI grows.

### Alternatives Considered

- **Full wagmi/viem client + a public RPC endpoint**, matching `safenet-staking-ui` exactly. Rejected for v1: this app never needs to run outside a Safe{Wallet} iframe or support external wallets/WalletConnect, so the SDK's own `eth` passthrough is strictly sufficient for reads and writes, and viem is used only as an ABI-encoding utility, not a client. Revisit if the app ever needs to run standalone.
- **A subgraph or indexer for dispute history**, instead of `eth_getLogs` from the app. Rejected for v1: adds infrastructure to operate and keep in sync, for a dispute volume that should be low (disputes are the non-unanimous minority outcome) and low enough for direct log queries. Revisit if querying becomes slow or an indexer is already maintained elsewhere.
- **Vendoring `safenet` as a git submodule**, matching how `governance/contracts/lib/zodiac-module-reality` is vendored, to have a traceable source for the ABI fragments. Rejected for v1: `safenet` publishes no generated TypeScript/ABI artifact for a submodule to expose — the fragments would still be hand-copied from Solidity source either way, and a submodule adds a second, differently-versioned toolchain (Rust/Foundry) to a purely npm package for no build-time benefit. A pinned-commit code comment next to the hand-written fragments gives the same traceability more cheaply. Revisit if `safenet` starts publishing generated bindings.
- **A repo-root `apps/` directory** (sibling to `governance/`, matching how `examples/` sits at the root today), instead of nesting under `governance/`. Considered, since a root-level directory would mirror `examples/`'s precedent and read as "any frontend app," not specifically a governance one. Rejected: this app is Safenet governance/arbitration tooling specifically — it exists to operate `SentinelOracle`, the same category of thing `governance/contracts` covers for `RealityVetoModule` — so grouping it under `governance/` by purpose is more useful than grouping it by "is a frontend package." `governance/apps/` as a sibling to `governance/contracts/` still keeps the npm and Foundry toolchains in separate directories, so `just check`/`just fix` wiring doesn't mix them.

---

## User Flow

An owner of the ARBITRATOR Safe opens Safe{Wallet}, adds/opens this app as a custom Safe App while connected as that Safe, and:

1. Sees a list of requests currently `FROZEN` on the configured `SentinelOracle`, each showing its request ID, sponsor address, approve/deny sentinel counts, and arbitration deadline.
2. Picks a frozen request, chooses **Approve**, **Deny**, or **Decline** (out of scope), and enters a short rationale (the `context` string `resolveDispute`/`markOutOfScope` records on-chain).
3. Confirms the transaction in Safe{Wallet}'s own transaction modal, which then follows the Safe's normal multisig confirmation/execution flow — each owner's confirmation there is their "vote"; reaching the Safe's threshold executes the ruling.
4. Once executed, the request drops off the frozen list on next load/refresh (its state is now `RESOLVED_APPROVED`/`RESOLVED_DENIED`).

### Page Layout

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Arbitration                                                                     │
├────────────────────────────────────────────────────────────────────────────────┤
│ Request ID     Sponsor       Approve/Deny   Deadline     Action                 │
│ ────────────────────────────────────────────────────────────────────────────── │
│ 0xabc1...def2   0x1111...     3 / 2         block 123    [Approve][Deny][Decline] │
│ 0xfeed...face   0x2222...     1 / 4         block 456    [Approve][Deny][Decline] │
└────────────────────────────────────────────────────────────────────────────────┘
                     ↓ clicking Approve/Deny/Decline opens a small form
┌────────────────────────────────────────────────────────────────────────────────┐
│ Rule on 0xabc1...def2 — Approve                                                 │
│ Rationale: [______________________________________________]                    │
│                                                [Cancel]  [Submit to Safe]        │
└────────────────────────────────────────────────────────────────────────────────┘
```

No routing needed for v1 (single page + inline form); no wireframe beyond the above.

---

## Tech Specs

- **Package**: `governance/apps/safenet-arbitration/`, Vite + React + TypeScript, Tailwind CSS.
- **SDK**: `@safe-global/safe-apps-sdk` (no `safe-apps-react-sdk` needed for a single-page app of this size — a thin custom hook around the plain SDK is enough).
- **Data fetching**: `@tanstack/react-query` (as in `safenet-staking-ui`) around plain async functions that call the SDK, for loading/error/refetch state and caching — without wagmi, since there is no wallet connector or RPC transport to configure.
- **Config validation**: `zod` schema over the Vite environment variables, failing loudly on invalid build config.
- **ABI encoding**: `viem`, used only for `parseAbiItem`/`encodeFunctionData`/`decodeFunctionResult` against a small hand-written set of fragments (see Architecture Decision) — no `PublicClient`/`WalletClient`.
- **Safe App manifest**: `public/manifest.json` (`name`, `description`, `iconPath`) per Safe Apps requirements, so the app can be added to Safe{Wallet} as a custom app.
- **Config** (build variables, `.env`/`.env.sample` — can be made configurable per environment later):
  - `VITE_CHAIN_ID` — `100` (Gnosis Chain) by default, matching the current testnet deployment.
  - `VITE_SENTINEL_ORACLE_ADDRESS` — `0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0` by default (testnet `SentinelOracle`).
  - `VITE_LOG_BLOCK_RANGE` — `10000` by default, the number of blocks searched for dispute logs per page.
- **Reads**:
  - `DisputeTriggered(bytes32 indexed requestId, uint64 deadline)` logs via `sdk.eth.getPastLogs`, to enumerate requests that have ever been frozen.
  - `DisputeResolved`/`DisputeOutOfScope`/`ArbitrationTimedOut` logs (all indexed by `requestId`) via the same call, to drop requests that are no longer open.
  - Logs are searched in pages of `VITE_LOG_BLOCK_RANGE` blocks, starting at the latest block; older pages are loaded on demand ("Load older"), so no single `eth_getLogs` call spans the whole chain. Requests are listed newest dispute first, so loading older pages only appends rows.
  - `getRequest(requestId)` via `sdk.eth.call`, to read the authoritative current `state`, sentinel counts, sponsor, and `arbitrationDeadline` for whatever's left after the above filter — logs establish which request IDs exist, `getRequest` establishes truth for each.
- **Writes**: `sdk.txs.send({ txs: [{ to: VITE_SENTINEL_ORACLE_ADDRESS, value: '0', data: <calldata> }] })`, where `<calldata>` is either `resolveDispute(requestId, approveWins, context)` (Approve/Deny) or `markOutOfScope(requestId, context)` (Decline).
- **Test cases** (Vitest):
  - Request-list derivation (which request IDs are still open) from mocked log/`getRequest` data.
  - `resolveDispute` and `markOutOfScope` calldata encoding, including a non-trivial `context` string.
- Root `Justfile`: extend `build`/`check`/`fix`/`test` recipes to cover the new package (`npm ci`, `npm run build`, `eslint`/`prettier`/`tsc --noEmit`, `vitest run`), plus a dev-only `safenet-arbitration-app-dev` recipe.

---

## Implementation Phases

### Phase 1 — App scaffold (separate PR)

- `governance/apps/safenet-arbitration/` Vite + React + TypeScript project (`package.json`, `vite.config.ts`, `tsconfig.json`, Tailwind setup, ESLint/Prettier config matching `safenet-staking-ui` conventions).
- `@safe-global/safe-apps-sdk` and `viem` dependencies; a small `useSafeAppsSdk`-style hook/module initializing the SDK and exposing `safe.getInfo()`.
- `public/manifest.json` and placeholder icon.
- Root `Justfile` wiring (`build`, `check`, `fix`, `test`, `safenet-arbitration-app-dev` recipes) and root `README.md`/`AGENTS.md` architecture section updates, adding the new package under the existing Governance description.
- Single placeholder page (no request logic yet) confirming the SDK connects and shows the connected Safe address/chain — enough to verify the app loads correctly inside Safe{Wallet}.

### Phase 2 — List arbitrated (frozen) requests (separate PR, depends on Phase 1)

- `.env.sample` with `VITE_CHAIN_ID`/`VITE_SENTINEL_ORACLE_ADDRESS`/`VITE_LOG_BLOCK_RANGE`.
- Hand-written `SentinelOracle` ABI fragments (`getRequest`, the four dispute events), pinned to the commit referenced in this plan.
- Data-fetching module: `sdk.eth.getPastLogs` for the four dispute events, `sdk.eth.call` + `getRequest` per surviving request ID.
- Request list UI component (table per the wireframe above) with loading/empty/error states and "Load older" pagination.
- Unit tests for list-derivation logic.

### Phase 3 — Ruling ("vote") actions (separate PR, depends on Phase 2)

- `resolveDispute(bytes32,bool,string)` and `markOutOfScope(bytes32,string)` ABI fragments and calldata encoding.
- Approve/Deny/Decline buttons with a rationale (`context`) input per frozen request, wired to `sdk.txs.send`.
- Pending/submitted/error UI state around the send call (the app does not need to poll for execution — that is Safe{Wallet}'s job — but should show that a transaction was successfully queued).
- Unit tests for calldata encoding.

### Phase 4 — UI/UX improvements (separate PR, depends on Phase 3)

Deployment is no longer part of this epic: the app is deployed via Cloudflare, set up outside this repo.

- Dark/light mode. The Safe Apps SDK doesn't expose Safe{Wallet}'s theme, so the app follows the system `prefers-color-scheme`, which matches Safe{Wallet}'s default "system" theme setting. Colors are defined once as semantic Tailwind theme tokens in `src/index.css`, with light and dark values side by side.
- Pointer cursor on every enabled button.

### Phase 5 — Remove this plan (separate PR, depends on Phase 4)

- Delete `epics/2026_09_23_arbitration_safe_app.md` once Phases 1–4 have shipped.

---

## Assumptions

- **Assumption**: `ARBITRATOR` is itself a Safe (so this app runs meaningfully as a Safe App with a multisig confirmation flow standing in for "voting"). If a deployment instead sets `ARBITRATOR` to an EOA, the app still works, but the "voting" framing is less literal — a single signer just executes directly.
- **Assumption**: default config (`VITE_CHAIN_ID=100`, `VITE_SENTINEL_ORACLE_ADDRESS=0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0`) points at the current Gnosis Chain testnet `SentinelOracle`, since Safenet is early/WIP with no production deployment yet. Revisit these values once a production `SentinelOracle` is live — a `.env` change, not a code change.
- **Out of scope for v1**: surfacing/triggering the permissionless `timeoutArbitration` fallback, sentinel-level commit/reveal voting UI (a different, bonded, secret-salt flow unrelated to the arbitrator's ruling — see the contract's own `// VOTING` section for `commit`/`reveal`), history of already-resolved disputes, end-to-end (Playwright) tests, and standalone (non-Safe{Wallet}) operation.
- **Assumption**: single `SentinelOracle` per deployment of this app. Supporting multiple oracles/chains from one app instance is out of scope for v1.
