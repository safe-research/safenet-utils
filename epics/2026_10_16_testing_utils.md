# Plan: Testing Utils

Component: new `testing/` package (static JSON test transactions plus bash scripts built on Foundry's `cast`, `curl` and `jq`, instrumented via the root `Justfile`).

---

## Overview

Operators of a Safenet-secured Safe (and the Safenet team) need a quick, repeatable way to check that the production Sentinels are active and rule the most common transaction paths as the [Safenet Arbitration Charter](https://github.com/safe-research/safenet-charter/blob/latest-safedao-approved/Safenet_Arbitration_Charter.md) requires. Today this means hand-building calldata in Safe{Wallet} or calling `ProposeTransaction.s.sol` in the `safenet` repo one transaction at a time.

This epic adds a small `testing/` package that contains:

- A **collection of test transactions** as static JSON files, one file per case, in the same shape as the [sentinel test vectors](https://github.com/safe-research/sentinel-test-vectors). Each file holds the complete Safe transaction (concrete token, receivers and calldata) and its expected Charter verdict (`secure` or `insecure` plus the rule). The collection also includes the **setup** transactions that make receivers "known" (a prior transfer to them).
- A script that **proposes** a selection of these files **directly to Safenet** via the relayer ([`safenet-proxy`](https://github.com/safe-research/safenet-proxy)) and prints the Safenet explorer link for each.
- Optionally, a script that **proposes** a selection of these files to the **Safe{Wallet} interface** via the Safe Transaction Service API, signed with a proposer (delegate) key.
- A script that **creates a CoW Swap order** in the CoW orderbook and creates or updates the matching pre-sign transaction in the collection (`<chainId>/allowed/cow-swap-trade.json`). This is the only test transaction that is generated, because it depends on a live order. Otherwise it is a test file like any other.

This is deliberately not an automated test suite. The scripts propose transactions and print the expected verdict. A human then compares that with the Sentinel votes shown in the explorer or the Safe{Wallet} interface. The goal is to check the production Sentinel service, not the reference `sentinel-engine` in the `safenet` repo. Expectations are therefore derived from the Charter only.

Steps, each a separate PR:

1. Scaffold `testing/` with the shared bash library (env validation, network maps, loading and hashing a test transaction file), plus `Justfile`/README/AGENTS wiring.
2. Add the Gnosis Chain test transaction collection, including the unsupported-network case.
3. Add the Safenet relayer proposal script with explorer links.
4. Add the CoW Swap order script.
5. Add the Ethereum Mainnet and Arbitrum One collections.
6. Add the (optional) Safe{Wallet} proposal script, which proposes via the Safe Transaction Service.
7. Remove this plan.

The phases are ordered by priority. Phases 1–3 are the minimum needed to check Sentinels on Gnosis Chain. Proposing to Safe{Wallet} is optional, so it comes last. Phases 3–6 only depend on phases 1 and 2, so they can also be done in parallel.

---

## Architecture Decision

New top-level `testing/` directory, sibling to `governance/`. The scripts are operational tooling for any Safenet-secured Safe, not governance tooling, so they don't belong under `governance/`.

**Test transactions are data, not code.** Each case is one JSON file under `testing/transactions/<chainId>/<set>/<case>.json` with all transaction data present. You can read, review and diff a file without running anything. New cases are added by copying a file, and the cases can be reused with other tools such as the sentinel test vectors runner. The only generated transaction is the CoW Swap trade, which has its own script that refreshes its file in the collection (see below).

**Safe-specific values are filled in at proposal time.** A test file can't know which Safe it will run against, so it uses placeholder addresses. The proposal scripts replace them using a read of the Safe from the Safe Transaction Service (`GET https://api.safe.global/tx-service/<network>/api/v1/safes/<SAFE_ADDRESS>/`, fields `nonce` and `owners`). The scripts make no RPC calls. There is no chain setting: each transaction is proposed on the chain of its file (`chainId`), for `SAFE_ADDRESS` on that chain, and the Safe is read once per chain. For a chain on which the Safe can't be read (e.g. it isn't deployed there), its nonce and owners can be set per chain ID as JSON in `SAFE_INFO` instead.

| Placeholder                                  | Replaced with            |
| -------------------------------------------- | ------------------------ |
| `0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe` | `SAFE_ADDRESS`           |
| `0xa11cea11cea11cea11cea11cea11cea11cea11ce` | `owners[0]` (receiver A) |
| `0xb0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0` | `owners[1]` (receiver B) |

- Placeholders are replaced with a case-insensitive find and replace of their 40 hex characters in the whole file, so they are replaced in `safe`, `to` and in `data`, where they appear as ABI-encoded address words. The replaced addresses are lowercase. They are chosen so that they can't plausibly occur by accident.
- The Safe's owners are the transfer receivers, so test funds are never sent to an outside address. If the Safe has fewer than 2 owners, the scripts abort.
- `nonce` is replaced with the Safe's current nonce on the chain of the file. To use another nonce, set the chain's nonce and owners in `SAFE_INFO`.

All other fields (`chainId`, `value`, `operation`, gas and refund parameters) are used exactly as written.

**All proposed transactions share the current nonce.** This makes them alternatives to each other, so executing one (accidentally) invalidates all others. The `allowed` and `blocked` sets are not meant to be executed. The `setup` set is meant to be executed: the intended flow is to propose `setup`, have the owners execute it, and only then propose `allowed`/`blocked`.

**Bash + Foundry's `cast` + `curl` + `jq`** with no build step and no package manager. Foundry is already a repo requirement. `cast` covers everything the scripts need: ABI encoding (`cast calldata`, `cast abi-encode`), hashing (`cast keccak`), and signing a raw hash (`cast wallet sign --no-hash`). `curl` + `jq` handle the HTTP APIs and JSON. Each script stays short and readable from top to bottom.

**Proposal scripts take file and directory paths**, the same way the test vectors' `run-tests.sh` does:

```
create-cow-order.sh ─► creates/updates <chainId>/allowed/cow-swap-trade.json
                                   │
testing/transactions/<chainId>/<set>/*.json ─┬─► propose-safe-wallet.sh <path>...
                                             └─► propose-safenet.sh <path>...
```

**Safe transaction hashes are computed locally.** They use EIP-712 with the `chainId` + `verifyingContract` domain used by Safe >= 1.3.0, which are the only singleton versions the Charter accepts. They are not read via `getTransactionHash`. That way, no RPC is needed at all.

**Safenet submission uses the relayer's full-transaction endpoint (`POST /tx`).** This is the endpoint the Safenet explorer posts to. Unlike the `/propose` webhook endpoint, it doesn't need the transaction to exist in the Safe Transaction Service (which is only used to read the nonce). Because the relayer returns an empty `202`, the script derives the `safeTxHash` itself to print the explorer link.

### Alternatives Considered

- **Generating the transactions with a script (bash or a Forge script) from env vars (token, receivers, …):** more flexible per Safe, but the transactions are then hidden behind code. They can't be reviewed or shared as fixtures, and they aren't compatible with the test vectors. Rejected. The only per-Safe values (`safe`, `nonce`) are substituted at proposal time instead.
- **Fully concrete files including `safe`, receivers and `nonce`:** would require one copy of the collection per Safe, and the files would go stale with every executed transaction. Rejected in favour of the placeholder substitution.
- **Fixed team-controlled receiver addresses:** no substitution in calldata needed, but every tested Safe would send funds to the team. Using the Safe's own owners keeps the funds with the people running the test. Rejected.
- **TypeScript (viem) scripts:** more robust JSON/HTTP handling, but adds an npm package and a dependency install step for what are a handful of hash/sign/POST calls. Rejected as heavier than needed ("simple and use existing tools").
- **Safenet submission via `/propose` (Tx Service webhook body):** needs the transaction to already exist in the Safe Transaction Service and only works for the chains in the proxy's short-name map. That rules out the unsupported-network case. Rejected in favour of `/tx`.
- **Reading the nonce via RPC (`cast call … nonce()`):** would add an `RPC_URL` and RPC handling to the scripts. The Safe Transaction Service already exposes the nonce, and the optional Safe{Wallet} proposals use it anyway. Rejected.
- **Distinct nonces for every test transaction:** would let them be executed in sequence, but `blocked` transactions must never be executed, and an unexecuted lower nonce blocks all higher ones in Safe{Wallet}. Rejected.
- **A static CoW Swap test file:** a pre-sign transaction is only meaningful with a live order whose UID, amounts and receiver match. A fixed order UID would expire or point to another owner, which makes the trade invalid (R-4.3/R-4.4) rather than valid. That's why a separate script creates a fresh order and updates the file in the collection before a run.

---

## Tech Specs

### Layout

```
testing/
├── README.md                    # Runbook: requirements, env vars, flows, expected verdicts table
├── .env.sample                  # All env vars with comments
├── lib/
│   └── common.sh                # Shared helpers (sourced by all scripts)
├── scripts/
│   ├── create-cow-order.sh      # Creates a CoW presign order → updates <chainId>/allowed/cow-swap-trade.json
│   ├── propose-safe-wallet.sh   # <path>... → Safe Transaction Service
│   └── propose-safenet.sh       # <path>... → Safenet relayer, prints explorer links
└── transactions/
    ├── 1/                       # Ethereum Mainnet
    ├── 10/                      # Unsupported network (R-4.0 case only)
    ├── 100/                     # Gnosis Chain
    │   ├── setup/
    │   ├── allowed/
    │   └── blocked/
    └── 42161/                   # Arbitrum One
```

### Test transaction file format

The same structure as the [sentinel test vectors](https://github.com/safe-research/sentinel-test-vectors) (`request` / `response` / `metadata`, hex quantities, `SafeTransaction` fields in Safe struct order), minus `request.block`, which has no meaning for a transaction that is proposed live:

```json
{
  "request": {
    "transaction": {
      "chainId": "0x64",
      "safe": "0x5afE5afE5afE5afE5afE5afE5afE5afE5afE5afE",
      "to": "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
      "value": "0x0",
      "data": "0xa9059cbb…",
      "operation": 0,
      "safeTxGas": "0x0",
      "baseGas": "0x0",
      "gasPrice": "0x0",
      "gasToken": "0x0000000000000000000000000000000000000000",
      "refundReceiver": "0x0000000000000000000000000000000000000000",
      "nonce": "0x0"
    }
  },
  "response": {
    "verdict": "secure"
  },
  "metadata": {
    "note": "Transfers 0.01 USDC.e to receiver A (the Safe's first owner), which the Safe paid in setup/known-receivers.json. Passes R-4.3: the receiver is in the expected target set (§ 2.4)."
  }
}
```

- `response.rule` is present if and only if `verdict` is `insecure`.
- Setup files have no `response`. They are not test cases, only preconditions.
- The file name (without `.json`) is the case name printed by the scripts.

The files are not validated by a script: the scripts assume that they follow this format.

### `lib/common.sh`

- `require_env <VAR>...`: fail with a clear error if any variable is unset or empty.
- `load_safe_tx <file>`: reads `request.transaction`, substitutes the placeholders and `nonce`, and outputs the transaction as JSON. All other fields are kept as written, so the transaction can be forwarded as is.
- `safe_tx_hash <tx-json>`: EIP-712 `SafeTx` hash computed with `cast abi-encode` + `cast keccak`.
- `collect_files <path>...`: expands directories to their `*.json` files (sorted), so that `transactions/100/allowed` and single files both work.
- `tx_service_network <chainId>`: `1 → eth`, `10 → oeth` (unsupported-network case), `100 → gno`, `42161 → arb1`. Fails otherwise.
- `safe_info <chainId>`: reads `nonce` and `owners` of `SAFE_ADDRESS` on `chainId` from the chain's entry in `SAFE_INFO`, if there is one, and from the Safe Transaction Service otherwise. Aborts if there are fewer than 2 owners.
- `cow_network <chainId>` (phase 4): `1 → mainnet`, `100 → xdai`, `42161 → arbitrum_one`. Fails otherwise.

### Environment variables

| Variable | Used by | Description |
| --- | --- | --- |
| `SAFE_ADDRESS` | all | Safe under test. Replaces the placeholder Safe. Its first two owners replace the receiver placeholders. |
| `SAFE_INFO` | proposal scripts | Optional JSON with the Safe's nonce and owners per chain ID (`{"10":{"nonce":0,"owners":["0x…","0x…"]}}`). Chains listed are not read from the Safe Transaction Service. |
| `PROPOSER_PRIVATE_KEY` | `propose-safe-wallet.sh` | Key of a delegate (or owner) of the Safe. Signs the proposal. |
| `SAFE_API_KEY` | proposal scripts | Optional API key for `api.safe.global` (sent as `Authorization: Bearer`). Without it, reads are limited to 1 request per minute, which is enough to test one chain per run. |
| `SAFENET_RELAYER_URL` | `propose-safenet.sh` | Full relayer endpoint URL (e.g. `https://<proxy>/tx`). The same value as the explorer's relayer setting. |
| `SAFENET_EXPLORER_URL` | `propose-safenet.sh` | Explorer base URL (default `https://safenet-explorer.eth.limo`). |
| `COW_SELL_TOKEN` | `create-cow-order.sh` | Token sold by the CoW order. |
| `COW_BUY_TOKEN` | `create-cow-order.sh` | Token bought by the CoW order. |
| `COW_SELL_AMOUNT` | `create-cow-order.sh` | Sell amount in base units, before fees. |
| `COW_VALID_FOR` | `create-cow-order.sh` | Order validity in seconds (default `3600`). |

Each script validates the variables it needs up front (`require_env`) and fails with a clear message. Secrets are never echoed. The scripts source `testing/.env` if it exists. Just's `dotenv` settings would apply repo-wide, so they aren't used.

### Test transaction collection

Expected verdicts follow the Charter. Its supported networks are chain IDs 1, 42161 and 100.

The test token on each chain is the canonical USDC deployment. The amount is a fixed 0.01 USDC (`10000` base units). Receivers A and B are the Safe's first two owners (through placeholders). MultiSend batches use the canonical MultiSendCallOnly v1.4.1 (`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`) via DELEGATECALL, which writes no Safe storage (R-4.2).

| File | Transaction | Verdict | Rule |
| --- | --- | --- | --- |
| `setup/known-receivers.json` | MultiSend: `USDC.transfer(A, 10000)`, `USDC.transfer(B, 10000)` | — | — |
| `allowed/transfer-known-receiver.json` | `USDC.transfer(A, 10000)` | secure | — |
| `allowed/multisend-transfer-known-receivers.json` | MultiSend: `USDC.transfer(A, 10000)`, `USDC.transfer(B, 10000)` | secure | — |
| `allowed/cancellation.json` | Self-call with empty data, CALL, value 0 (a Safe{Wallet} "reject" transaction) | secure | — |
| `allowed/reset-fallback-handler.json` | Self-call `setFallbackHandler(address(0))`, CALL, value 0 | secure | — |
| `allowed/cow-swap-trade.json` (generated by `create-cow-order.sh`) | MultiSend: `sellToken.approve(GPv2VaultRelayer, sellAmount)`, `GPv2Settlement.setPreSignature(orderUid, true)` | secure | — |
| `blocked/enable-unknown-module.json` | Self-call `enableModule(0x…dead)` with a clearly fake module | insecure | R-4.1 |
| `blocked/add-owner.json` | Self-call `addOwnerWithThreshold(0x…dead, 1)` with a clearly fake owner | insecure | R-4.1 |

The seven static files exist for each of `1/`, `100/` and `42161/`. They differ only in `chainId` and the USDC address. `cow-swap-trade.json` is created per chain by the script.

`10/blocked/unsupported-network-cancellation.json` is the same as `allowed/cancellation.json`, but with `chainId` 10 (Optimism). A cancellation is valid on any network and for any Safe, and it has no token or receiver. The only reason for it to be insecure is R-4.0, so the verdict tests the network rule alone. Comparing it with `allowed/cancellation.json` shows that the network is the only difference. Like every file, it is proposed for `SAFE_ADDRESS` on its own chain, so it needs the Safe's nonce and owners on Optimism. If the Safe isn't deployed there, they are set in `SAFE_INFO`.

The owner change uses `addOwnerWithThreshold` rather than `swapOwner`, because `swapOwner` needs the Safe-specific `prevOwner`/`oldOwner` in its calldata, and the files are static.

The setup file is identical to the MultiSend test on purpose. Executing it makes A and B known for USDC. The README notes that the setup transaction itself sends to receivers the Safe hasn't paid before (though they are its owners), so Sentinels may not rule it `secure`.

### Safe{Wallet} proposals (`propose-safe-wallet.sh <path>...`)

For each file:

1. `load_safe_tx` with the Safe's nonce and owners on the chain of the file.
2. Compute `safeTxHash` locally and sign it with `cast wallet sign --no-hash --private-key "$PROPOSER_PRIVATE_KEY"`.
3. `POST https://api.safe.global/tx-service/<network>/api/v2/safes/<SAFE_ADDRESS>/multisig-transactions/` with the Safe transaction fields plus `contractTransactionHash`, `sender` (the proposer address from `cast wallet address`), `signature`, and `origin` (`{"name":"safenet-utils test: <case>"}`), so the case is recognisable in the Safe{Wallet} queue.
4. Print one line per file: case, expected verdict (and rule), `safeTxHash`, HTTP status. Keep going after a failure and exit non-zero at the end if any proposal failed.

### Safenet proposals (`propose-safenet.sh <path>...`)

For each file:

1. `load_safe_tx` and compute `safeTxHash` locally.
2. `POST $SAFENET_RELAYER_URL` with the Safe transaction fields (`chainId, safe, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce`).
3. Print the case, the expected verdict (and rule), and `$SAFENET_EXPLORER_URL/#/safeTx?chainId=<chainId>&safeTxHash=<safeTxHash>`.

The relayer always answers `202` with an empty body, even for invalid input. Only a non-2xx response is treated as an error. The README points out that the explorer link is the way to confirm that a proposal landed.

### CoW Swap order (`create-cow-order.sh <chainId>`)

The chain is a required argument, because there is no test transaction file to take it from.

1. `POST https://api.cow.fi/<cow_network>/api/v1/quote` with `sellToken`, `buyToken`, `sellAmountBeforeFee = COW_SELL_AMOUNT`, `kind: sell`, `from = receiver = SAFE_ADDRESS`, `signingScheme: presign` and `validTo = now + COW_VALID_FOR`.
2. `POST https://api.cow.fi/<cow_network>/api/v1/orders` with the quoted order (fee folded into `sellAmount`, fee `0`), `signingScheme: presign` and `signature: SAFE_ADDRESS`. The response is the order UID.
3. Create or overwrite `testing/transactions/<chainId>/allowed/cow-swap-trade.json` (verdict `secure`, `metadata.note` with the order UID, the tokens, the amounts and `validTo`). The file contains a MultiSendCallOnly batch of:
   - `approve(GPv2VaultRelayer, sellAmount)`, with the exact order sell amount and not unlimited, so that R-4.5 does not apply;
   - `GPv2Settlement.setPreSignature(orderUid, true)`.
4. Print the file path and the CoW Explorer link of the order.

Like every other file, it uses the placeholder `safe`. The calldata doesn't contain the Safe address, but the order UID does: the order is only valid for the `SAFE_ADDRESS` that created it, until `validTo`. The file is therefore git-ignored (`testing/transactions/*/allowed/cow-swap-trade.json`). The README says to run `just testing-cow-order <chainId>` right before proposing the `allowed` set. If it hasn't been run, there is simply no CoW case in the set. GPv2Settlement (`0x9008D19f58AAbD9eD0D60971565AA8510560ab41`) and GPv2VaultRelayer (`0xC92E8bdf79f0507f65a392b0ab4667716BFE0110`) are the same on all three supported chains and are kept as constants.

### Just recipes

| Recipe                               | Runs                               |
| ------------------------------------ | ---------------------------------- |
| `testing-propose-safe-wallet *paths` | `propose-safe-wallet.sh {{paths}}` |
| `testing-propose-safenet *paths`     | `propose-safenet.sh {{paths}}`     |
| `testing-cow-order chain_id`         | `create-cow-order.sh {{chain_id}}` |

Example: `just testing-propose-safenet testing/transactions/100/allowed testing/transactions/100/blocked testing/transactions/10`.

`just check` gains `shellcheck` over `testing/**/*.sh`.

### Testing

There are no self-tests for the scripts and no format check for the collection. Each file's `metadata.note` explains the calldata, and the PR description shows the decoded calldata (`cast 4byte-decode`) of every new file, so that reviewers can check it. The proposal scripts are verified manually against a test Safe, as documented in each PR's description.

---

## Implementation Phases

### Phase 0 — Plan (this PR)

- `epics/2026_10_16_testing_utils.md`.

### Phase 1 — Scaffold and shared library

- `testing/README.md` (purpose; requirements: Foundry, `jq`, `curl`, `shellcheck`; file format; env overview; flows filled in by later phases), `testing/.env.sample`, `.gitignore` entry for `testing/.env`.
- `testing/lib/common.sh`: `require_env`, `collect_files`, `load_safe_tx`, `safe_tx_hash`, `tx_service_network`, `safe_info`.
- Root `Justfile` (`check`), root `README.md` and `AGENTS.md` Architecture sections.

Must land first. All later phases depend on it.

### Phase 2 — Gnosis Chain collection

- `testing/transactions/100/{setup,allowed,blocked}/*.json` (7 files) and `testing/transactions/10/blocked/unsupported-network-cancellation.json`.
- README section with the expected verdicts table.

Depends on phase 1. Gnosis Chain comes first because it is cheap to run the setup there.

### Phase 3 — Safenet proposal script

- `testing/scripts/propose-safenet.sh`, `testing-propose-safenet` recipe, README section "Propose to Safenet".
- `SAFE_INFO`, to set the Safe's nonce and owners per chain (needed for the unsupported-network case if the Safe isn't deployed on Optimism).

Depends on phase 1. Can be reviewed against the phase 2 files. Until phase 6 lands, the README explains how to create the setup transaction by hand in Safe{Wallet} (two small USDC transfers) so that owners can execute it.

### Phase 4 — CoW Swap order script

- `testing/scripts/create-cow-order.sh`, `cow_network` helper, `testing-cow-order` recipe, README section "CoW Swap trade".
- `.gitignore` entry for the generated `cow-swap-trade.json` files. The PR description includes a generated file for review.

Depends on phase 1. Can be done in parallel with phases 3, 5 and 6.

### Phase 5 — Ethereum Mainnet and Arbitrum One collections

- `testing/transactions/1/…` and `testing/transactions/42161/…` (7 files each), derived from the Gnosis files with only `chainId` and the USDC address changed.

Depends on phase 2 (it copies its files). Can be done in parallel with phases 3, 4 and 6. If reviewers prefer smaller PRs, it can be split into one PR per chain.

### Phase 6 — Safe{Wallet} proposal script (optional)

- `testing/scripts/propose-safe-wallet.sh`, `testing-propose-safe-wallet` recipe, README section "Propose to Safe{Wallet}" (including how to register the proposer as a delegate). The setup instructions switch from the manual steps to this script.

Depends on phase 1. Optional: Safenet testing works without it. It is a convenience for queueing the setup transaction, and for seeing the test transactions in the Safe{Wallet} queue. Can be done in parallel with phases 3–5.

### Phase 7 — Remove plan

- Delete `epics/2026_10_16_testing_utils.md`.

---

## Open Questions and Assumptions

- **Owners as receivers.** We assume that sending 0.01 USDC to its own owners is acceptable for any Safe under test, and that owners being in the expected target set after a single setup transfer is enough for Sentinels (§ 2.4).
- **Expected verdicts for allowed cases.** We assume that "allowed" means the Sentinels vote `secure`. For `reset-fallback-handler` this follows from the R-4.1 exception. For transfers to known receivers, it follows from R-4.3 and the prior setup transfer (§ 2.4). Production Sentinels may reasonably need more history. A single prior transfer is the minimum this tooling sets up.
- **Setup execution.** The setup transaction must actually be executed. If the Safe already has the Safenet guard enabled, it goes through Safenet like any other transaction. If that blocks it, owners need the escape hatch or must run setup before enabling the guard. The README will document this.
- **Placeholders.** The three placeholder addresses are assumed never to be real addresses. Substitution is a plain text replacement over the whole file.
- **Unsupported-network case.** It is proposed for `SAFE_ADDRESS` on chain ID 10, so it needs the Safe's nonce and owners on Optimism (from the Safe Transaction Service or `SAFE_INFO`), and its `nonce`, `safeTxHash` and explorer link are those of chain ID 10. We assume that the relayer forwards any `chainId` (the proxy's `/tx` schema doesn't restrict it) and accepts hex quantities (its schema parses them with `z.coerce.bigint()`).
- **Compatibility with the test vectors.** The files omit `request.block` and use a placeholder Safe, so they are not directly valid test vectors. Upstreaming them would mean adding a block and a real Safe.
- **Safe Transaction Service API key.** `api.safe.global` allows 1 request per minute without an API key, which is enough for one read of the Safe per chain, so `SAFE_API_KEY` is optional for reading. We assume that the same holds for proposals (phase 6). If it doesn't, `propose-safe-wallet.sh` requires it.
- **Delegate setup.** Registering the proposer as a delegate is a one-time manual step via Safe{Wallet} or the delegates API. It is documented, not scripted.
- **CoW order API details.** We assume that the quote → order flow with fee `0` and the fee folded into `sellAmount` is still what the CoW API requires. This will be verified in phase 4.
- **Additional cases (not in scope, easy to add as files later):** a settings change inside a MultiSend (R-4.1, which requires a non-batched transaction), a max-`uint256` approval (R-4.5), and a transfer to a lookalike of a known receiver (R-4.3).
- **Relayer URL.** `SAFENET_RELAYER_URL` is the full endpoint (including `/tx`), matching the explorer's relayer setting, so the same value can be copied between the two.
