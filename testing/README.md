# Testing Utils

Tooling to check that the production Sentinels of [Safenet](https://github.com/safe-research/safenet) are active and rule the most common transaction paths as the [Safenet Arbitration Charter](https://github.com/safe-research/safenet-charter/blob/latest-safedao-approved/Safenet_Arbitration_Charter.md) requires.

It consists of a collection of test transactions, one JSON file per case, and bash scripts that propose them for a Safe under test. This is deliberately not an automated test suite: the scripts propose transactions and print a note on what each one exercises, and a human compares it with the Sentinel votes shown in the Safenet explorer or Safe{Wallet}.

## Requirements

- [Foundry](https://getfoundry.sh), whose `cast` is used for ABI encoding, hashing and signing
- [jq](https://jqlang.org)
- [curl](https://curl.se)
- [ShellCheck](https://www.shellcheck.net), to lint the scripts (`just check`)

## Layout

```
testing/
├── .env.sample                  # All environment variables, with comments
├── lib/
│   └── common.sh                # Shared helpers, sourced by all scripts
├── scripts/
│   ├── create-cow-order.sh      # Creates a CoW presign order → writes generated/cow-swap-trade-<chainId>.json
│   ├── propose-safe-wallet.sh   # <path>... → Safe Transaction Service, prints Safe{Wallet} links
│   └── propose-safenet.sh       # <path>... → Safenet relayer, prints explorer links
└── transactions/<folder>/<case>.json
```

The folders are:

- `setup`: preconditions, such as the transfers that make the receivers "known". These are meant to be executed.
- `templates`: test transactions that exercise the rules of the Charter. They are meant to be proposed, never executed: some of them, such as `add-owner.json`, would harm the Safe.
- `generated`: test transactions created by scripts for a specific Safe and chain, such as the [CoW Swap trade](#cow-swap-trade). Git-ignored.

## Test Transaction Files

A test transaction file is a template for a Safe transaction (the Safe transaction fields in Safe struct order, with hex quantities), plus metadata:

```json
{
  "transaction": {
    "safe": "0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE",
    "to": "0x70ce70ce70ce70ce70ce70ce70ce70ce70ce70ce",
    "value": "0x0",
    "data": "0xa9059cbb000000000000000000000000a11cea11cea11cea11cea11cea11cea11cea11ce0000000000000000000000000000000000000000000000000000000000002710",
    "operation": 0,
    "safeTxGas": "0x0",
    "baseGas": "0x0",
    "gasPrice": "0x0",
    "gasToken": "0x0000000000000000000000000000000000000000",
    "refundReceiver": "0x0000000000000000000000000000000000000000"
  },
  "metadata": {
    "note": "Transfers 10000 base units of the test token to receiver A (the Safe's first owner), which the Safe paid in setup/known-receivers.json. Exercises R-4.3: the receiver is in the expected target set (§ 2.4)."
  }
}
```

- `transaction` has no `chainId` and no `nonce`: the scripts set them to `CHAIN_ID` and the Safe's current nonce. A generated file may set `chainId`, if it is only valid on that chain; proposing it on another chain is an error.
- `metadata.note` is required and explains the calldata and the rules of the Charter that the transaction exercises. The notes describe what to look for, not a verdict that is set in stone: compare them with the Sentinel votes.
- `metadata.reference` is optional, a link to the [sentinel test vector](https://github.com/safe-research/sentinel-test-vectors) the transaction is based on, pinned to a commit. Leave it out if there is none.
- The file name (without `.json`) is the case name printed by the scripts.

A template can't know which Safe and chain it will run against, so it uses placeholder addresses. The scripts replace their 40 hex characters anywhere in the file (case-insensitively, so this includes the ABI-encoded address words in `data`) with the lowercase addresses:

| Placeholder                                  | Replaced with                 |
| -------------------------------------------- | ----------------------------- |
| `0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe` | `SAFE_ADDRESS`                |
| `0xa11cea11cea11cea11cea11cea11cea11cea11ce` | `owners[0]` (receiver A)      |
| `0xb0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0` | `owners[1]` (receiver B)      |
| `0x70ce70ce70ce70ce70ce70ce70ce70ce70ce70ce` | The [test token](#test-token) |

The Safe's owners are the receivers, so test funds are never sent to an outside address. All other fields are used exactly as written. The `safe` of every file must be the placeholder, so that no real Safe address is ever committed.

### Test Token

The transfers use the test token: `TOKEN_ADDRESS` if set, and otherwise the canonical USDC deployment of the networks of the Charter:

| Chain | `CHAIN_ID` | Default test token |
| --- | --- | --- |
| Ethereum Mainnet | `1` | USDC, `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Gnosis Chain | `100` | USDC.e (bridged USDC), `0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0` |
| Arbitrum One | `42161` | USDC (native), `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

On any other chain, a file that uses the test token can only be proposed with `TOKEN_ADDRESS` set. Every transfer is a fixed `10000` base units, 0.01 of a token with 6 decimals such as USDC.

## Test Transaction Collection

The notes follow the Charter, whose supported networks are chain IDs 1, 100 and 42161. Receivers A and B are the Safe's first two owners. Batches are a DELEGATECALL to the canonical MultiSendCallOnly v1.4.1 (`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`), which writes no Safe storage (R-4.2).

| File | Transaction | Exercises |
| --- | --- | --- |
| `setup/known-receivers.json` | MultiSend: `token.transfer(A, 10000)`, `token.transfer(B, 10000)` | — |
| `templates/transfer-known-receiver.json` | `token.transfer(A, 10000)` | R-4.3 (known receiver) |
| `templates/multisend-transfer-known-receivers.json` | MultiSend: `token.transfer(A, 10000)`, `token.transfer(B, 10000)` | R-4.2, R-4.3 (known receivers) |
| `templates/cancellation.json` | Self-call with empty data, CALL, value 0 (a Safe{Wallet} "reject" transaction) | No rule; R-4.0 on an unsupported network |
| `templates/reset-fallback-handler.json` | Self-call `setFallbackHandler(address(0))`, CALL, value 0 | R-4.1 (allowed exception) |
| `templates/enable-unknown-module.json` | Self-call `enableModule(0x…dEaD)` with a clearly fake module | R-4.1 |
| `templates/add-owner.json` | Self-call `addOwnerWithThreshold(0x…dEaD, 1)` with a clearly fake owner | R-4.1 |
| `generated/cow-swap-trade-<chainId>.json` (chains 1 and 100 only, see [CoW Swap Trade](#cow-swap-trade)) | MultiSend: `EURC.approve(GPv2VaultRelayer, 10000)`, `GPv2Settlement.setPreSignature(orderUid, true)` | R-4.3, R-4.4, R-4.5 |

The transfer templates rely on the Safe having paid A and B before, in `setup/known-receivers.json`, which puts them in the expected target set (§ 2.4). Execute the setup transaction before proposing the templates. The setup transaction is the same batch as the MultiSend template, but at that point the Safe hasn't paid A and B yet (although they are its owners), so Sentinels may not rule the setup transaction itself `secure`. If the Safe already has the Safenet guard enabled and this blocks the setup transaction, run the setup before enabling the guard, or use the escape hatch.

To exercise the network rule (R-4.0) alone, propose `templates/cancellation.json` with `CHAIN_ID` set to a network that is not listed in the Charter, such as Optimism (`10`). It needs the Safe's nonce and owners on that chain. If the Safe is not deployed there, add the chain to [`SAFE_INFO`](#safe-info).

## Environment

The scripts read their configuration from environment variables, and source `testing/.env` if it exists. Copy [`.env.sample`](./.env.sample) to `testing/.env` to get started. A variable that is set (and not empty) in the environment takes precedence over `testing/.env`, so a single run can override it. The `just` recipes also take `CHAIN_ID` and `SAFE_ADDRESS` as options, which fall back to the environment and `testing/.env` if left out:

```sh
just testing-propose-safenet [-c|--chain CHAIN_ID] [-s|--safe SAFE_ADDRESS] [PATH...]
just testing-cow-order [-c|--chain CHAIN_ID] [-s|--safe SAFE_ADDRESS]
```

| Variable | Description |
| --- | --- |
| `SAFE_ADDRESS` | Safe under test. Replaces the placeholder Safe. Its first two owners replace the receiver placeholders. |
| `CHAIN_ID` | Decimal chain ID that the test transactions are proposed on, and the CoW Swap order is created on. |
| `TOKEN_ADDRESS` | Optional test token, which replaces the token placeholder. Defaults to the canonical USDC of the chain, see [Test Token](#test-token). |
| `SAFE_API_KEY` | Optional API key for `api.safe.global`, used to read the Safe's nonce and owners from the Safe Transaction Service. Without it, the API allows 1 request per minute. A script run reads the Safe once, so this is enough for one run per minute. `propose-safe-wallet.sh` also sends it with every proposal (one request per file). |
| `SAFE_INFO` | Optional JSON with the Safe's nonce and owners per chain ID, instead of reading them from the Safe Transaction Service. See [Safe Info](#safe-info). |
| `PROPOSER_PRIVATE_KEY` | Private key of a proposer (delegate) or an owner of the Safe, which signs the proposals. Used by `propose-safe-wallet.sh`, see [Propose to Safe{Wallet}](#propose-to-safewallet). |
| `SAFENET_RELAYER_URL` | Full URL of the Safenet relayer's transaction endpoint (e.g. `https://<proxy>/tx`), the same value as the explorer's relayer setting. Used by `propose-safenet.sh`. |
| `SAFENET_EXPLORER_URL` | Safenet explorer base URL for the printed links. Defaults to `https://safenet-explorer.eth.limo`. |

Every test transaction of a run is proposed on `CHAIN_ID`, for `SAFE_ADDRESS` on that chain, with the Safe's nonce and owners on that chain. The Safe must have at least 2 owners. All proposed transactions share the same nonce, so they are alternatives to each other: executing one invalidates all others.

### Safe Info

By default, the nonce and owners are read from the Safe Transaction Service. To set them by hand instead, for example for a chain on which the Safe is not deployed (such as Optimism for the unsupported-network case), set `SAFE_INFO` to JSON with an entry per chain ID, in `testing/.env` or in the environment (for example in CI):

```sh
SAFE_INFO='{"10":{"nonce":0,"owners":["0x…","0x…"]}}' just testing-propose-safenet -c 10 testing/transactions/templates/cancellation.json
```

A chain with an entry is never read from the Safe Transaction Service, and the other chains still are. Its first two `owners` are receivers A and B. To propose at a nonce other than the current one, set the chain's entry in `SAFE_INFO`.

## Setup

Before proposing the templates, the Safe must have paid receivers A and B (its first two owners) once, as in `setup/known-receivers.json`. Queue the setup transaction in Safe{Wallet} with [`propose-safe-wallet.sh`](#propose-to-safewallet), which proposes it by default:

```sh
just testing-propose-safe-wallet -c 100
```

Then have the owners sign and execute it in Safe{Wallet}. The Safe must hold at least 20000 base units of the [test token](#test-token) (0.02 USDC by default). Only then propose the templates below, with the Safe's new nonce.

## Propose to Safenet

`propose-safenet.sh` proposes test transaction files directly to Safenet, through the relayer's full-transaction endpoint (`POST $SAFENET_RELAYER_URL`, the endpoint the Safenet explorer posts to). Pass any number of files or directories; the recipe proposes all templates if there are none:

```sh
just testing-propose-safenet -c 100 -s 0x…
just testing-propose-safenet -c 100 testing/transactions/setup
```

It needs `SAFE_ADDRESS`, `CHAIN_ID` and `SAFENET_RELAYER_URL`. Every transaction goes to `CHAIN_ID`, so the first example above proposes all templates for Safe `0x…` on Gnosis Chain, and the second one the setup transaction for `SAFE_ADDRESS`. For each file, it prints the case, its note (and reference, if any) and the Safenet explorer link of the transaction:

```
transfer-known-receiver
  note:       Transfers 10000 base units of the test token to receiver A (the Safe's first owner), …
  safeTxHash: 0x…
  explorer:   https://safenet-explorer.eth.limo/#/safeTx?chainId=100&safeTxHash=0x…
```

Open the links and compare the Sentinel votes with the note. The relayer answers every request with an empty `202`, even if it can't parse the transaction, so the explorer link is the only way to confirm that a proposal landed. Only a non-2xx response is reported as an error. The script keeps going after a relayer error and exits non-zero at the end. A file that can't be loaded, such as a generated file for another chain, stops the script.

The transactions are not added to the Safe Transaction Service, so they don't show up in the Safe{Wallet} queue (use [`propose-safe-wallet.sh`](#propose-to-safewallet) for that). The `safeTxHash` is computed locally.

## Propose to Safe{Wallet}

`propose-safe-wallet.sh` proposes test transaction files to the Safe Transaction Service, so that they show up in the Safe{Wallet} queue of the Safe. Pass any number of files or directories; the recipe proposes the setup transaction if there are none:

```sh
just testing-propose-safe-wallet -c 100
just testing-propose-safe-wallet -c 100 testing/transactions/templates
```

It needs `SAFE_ADDRESS`, `CHAIN_ID` and `PROPOSER_PRIVATE_KEY`. Every transaction goes to `CHAIN_ID`, with the Safe's current nonce on that chain. The script computes the `safeTxHash` locally, signs it with `PROPOSER_PRIVATE_KEY`, and names the case in the transaction's origin (`safenet-utils test: <case>`). For each file, it prints the case, its note (and reference, if any) and the Safe{Wallet} link of the transaction:

```
known-receivers
  note:       Batches two transfers of 10000 base units of the test token (0.01 of a 6-decimal token such as USDC), …
  safeTxHash: 0x…
  safe:       https://app.safe.global/transactions/tx?safe=gno:0x…&id=multisig_0x…_0x…
```

A failed proposal is reported with the response of the Safe Transaction Service. The script keeps going after a proposal error and exits non-zero at the end. A file that can't be loaded stops the script, as with `propose-safenet.sh`. Proposals go to the Safe Transaction Service of `CHAIN_ID`, so they only work on chains it is known for (1, 10, 100 and 42161), even if the Safe's nonce and owners are set in `SAFE_INFO`. The templates can also be proposed this way, to see them in the queue. Never execute them: all transactions share the same nonce, and some of them would harm the Safe.

`PROPOSER_PRIVATE_KEY` must be the key of a proposer (a delegate) or of an owner of the Safe. Use a dedicated proposer key: it can only propose, not confirm or execute, and it needs no funds. The key is passed to `cast` on the command line, so don't use it on a shared machine. To register the proposer once per Safe and chain:

1. Create a key, for example with `cast wallet new`, and set it as `PROPOSER_PRIVATE_KEY`.
2. In Safe{Wallet}, open the Safe on the chain, go to Settings → Setup → Proposers, click "Add proposer", and enter the address of the key (`cast wallet address --private-key …`).
3. Sign the request with an owner wallet.

A proposer's signature is not a confirmation, so the owners still sign every proposed transaction in Safe{Wallet}. If an owner key is used instead, the proposal counts as its confirmation.

## CoW Swap Trade

A CoW Swap trade is only meaningful with a live order: a pre-signature for an expired order, or for an order of another owner, is invalid (R-4.3/R-4.4) rather than secure. So, unlike the templates, the CoW Swap trade is not committed, but generated by `create-cow-order.sh` for the Safe under test and `CHAIN_ID`, right before proposing it:

```sh
just testing-cow-order -c 100
just testing-propose-safenet -c 100 testing/transactions/templates testing/transactions/generated/cow-swap-trade-100.json
```

It needs `SAFE_ADDRESS` and `CHAIN_ID`. The script creates an order in the [CoW Protocol orderbook](https://docs.cow.fi/cow-protocol/reference/apis/orderbook) with fixed parameters: a stablecoin swap of 0.01 EURC for at least 0.0099 EURe, with the Safe as the owner and the receiver, and no separate fee:

| Chain | Sells (`10000` base units) | Buys (at least `9900000000000000` base units) |
| --- | --- | --- |
| Ethereum Mainnet | EURC, `0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c` | EURe, `0x39b8B6385416f4cA36a20319F70D28621895279D` |
| Gnosis Chain | EURC.e (bridged EURC), `0x54E4cB2a4Fa0ee46E3d9A98D13Bea119666E09f6` | EURe, `0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430` |

There is no EURC on Arbitrum One, so there is no CoW Swap case there yet. The order uses pre-signing, so it only becomes valid once the Safe executes the transaction, which is never meant to happen. The script then creates or overwrites `testing/transactions/generated/cow-swap-trade-<chainId>.json` with a MultiSendCallOnly batch of:

- `approve(GPv2VaultRelayer, 10000)` on EURC, for exactly the order's sell amount, so that R-4.5 (unlimited approvals) does not apply;
- `GPv2Settlement.setPreSignature(orderUid, true)`.

It prints the path of the file and the CoW Explorer link of the order. The order is valid until the end of the next full hour (between one and two hours), so every run within the same hour yields the same order UID and the same file: the script computes the UID locally and reuses the order if it already exists. The file uses the placeholder Safe like the templates, but sets `chainId`, and its order UID contains `SAFE_ADDRESS` and the order's expiry, so the `generated` folder is git-ignored. Recreate the file for every run, and for every Safe.
