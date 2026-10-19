# Testing Utils

Tooling to check that the production Sentinels of [Safenet](https://github.com/safe-research/safenet) are active and rule the most common transaction paths as the [Safenet Arbitration Charter](https://github.com/safe-research/safenet-charter/blob/latest-safedao-approved/Safenet_Arbitration_Charter.md) requires.

It consists of a collection of test transactions, one JSON file per case, and bash scripts that propose them for a Safe under test. This is deliberately not an automated test suite: the scripts propose transactions and print the expected verdict, and a human compares it with the Sentinel votes shown in the Safenet explorer or Safe{Wallet}.

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
│   └── propose-safenet.sh       # <path>... → Safenet relayer, prints explorer links
└── transactions/<chainId>/<set>/<case>.json
```

The sets are:

- `setup`: preconditions, such as the transfers that make the receivers "known". These are meant to be executed.
- `allowed`: test cases the Sentinels must rule `secure`. Not meant to be executed.
- `blocked`: test cases the Sentinels must rule `insecure`. Never execute these.

## Test Transaction Files

A test transaction file has the same structure as a [sentinel test vector](https://github.com/safe-research/sentinel-test-vectors) (`request` / `response` / `metadata`, hex quantities, the Safe transaction fields in Safe struct order), minus `request.block`, which has no meaning for a transaction that is proposed live:

```json
{
  "request": {
    "transaction": {
      "chainId": "0x64",
      "safe": "0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE",
      "to": "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
      "value": "0x0",
      "data": "0xa9059cbb000000000000000000000000a11cea11cea11cea11cea11cea11cea11cea11ce0000000000000000000000000000000000000000000000000000000000002710",
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

- `response.rule` is present if and only if `verdict` is `insecure`. Files in `allowed` expect `secure`, files in `blocked` expect `insecure`.
- Setup files have no `response`: they are preconditions, not test cases.
- `metadata.note` is required and explains the calldata and the expected verdict.
- The file name (without `.json`) is the case name printed by the scripts.

A file can't know which Safe it will run against, so it uses placeholder addresses. The scripts replace their 40 hex characters anywhere in the file (case-insensitively, so this includes the ABI-encoded address words in `data`) with the lowercase addresses, and replace `nonce` with the Safe's current nonce:

| Placeholder                                  | Replaced with            |
| -------------------------------------------- | ------------------------ |
| `0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe` | `SAFE_ADDRESS`           |
| `0xa11cea11cea11cea11cea11cea11cea11cea11ce` | `owners[0]` (receiver A) |
| `0xb0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0b0bb0` | `owners[1]` (receiver B) |

The Safe's owners are the receivers, so test funds are never sent to an outside address. All other fields are used exactly as written. The `safe` of every file must be the placeholder, so that no real Safe address is ever committed.

## Test Transaction Collection

The expected verdicts follow the Charter, whose supported networks are chain IDs 1, 100 and 42161.

The test token is the canonical USDC deployment of the chain (USDC.e, `0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0`, on Gnosis Chain), and every transfer is a fixed 0.01 USDC (`10000` base units). Receivers A and B are the Safe's first two owners. Batches are a DELEGATECALL to the canonical MultiSendCallOnly v1.4.1 (`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`), which writes no Safe storage (R-4.2).

| File | Transaction | Verdict | Rule |
| --- | --- | --- | --- |
| `100/setup/known-receivers.json` | MultiSend: `USDC.transfer(A, 10000)`, `USDC.transfer(B, 10000)` | — | — |
| `100/allowed/transfer-known-receiver.json` | `USDC.transfer(A, 10000)` | secure | — |
| `100/allowed/multisend-transfer-known-receivers.json` | MultiSend: `USDC.transfer(A, 10000)`, `USDC.transfer(B, 10000)` | secure | — |
| `100/allowed/cancellation.json` | Self-call with empty data, CALL, value 0 (a Safe{Wallet} "reject" transaction) | secure | — |
| `100/allowed/reset-fallback-handler.json` | Self-call `setFallbackHandler(address(0))`, CALL, value 0 | secure | — |
| `100/blocked/enable-unknown-module.json` | Self-call `enableModule(0x…dEaD)` with a clearly fake module | insecure | R-4.1 |
| `100/blocked/add-owner.json` | Self-call `addOwnerWithThreshold(0x…dEaD, 1)` with a clearly fake owner | insecure | R-4.1 |
| `10/blocked/unsupported-network-cancellation.json` | `100/allowed/cancellation.json` on Optimism (chain ID 10) | insecure | R-4.0 |

The allowed transfers expect `secure` because the Safe paid A and B before, in `setup/known-receivers.json`, which puts them in the expected target set (§ 2.4). Execute the setup transaction before proposing the `allowed` and `blocked` sets. The setup transaction is the same batch as the MultiSend test, but at that point the Safe hasn't paid A and B yet (although they are its owners), so Sentinels may not rule the setup transaction itself `secure`. If the Safe already has the Safenet guard enabled and this blocks the setup transaction, run the setup before enabling the guard, or use the escape hatch.

The unsupported-network case differs from `allowed/cancellation.json` only in its chain ID, so it tests the network rule alone. Like every other file, it is proposed for `SAFE_ADDRESS` on the chain of the file, so it needs the Safe to be deployed at the same address on Optimism (for example as a multichain Safe created with Safe{Wallet}), with at least 2 owners.

## Environment

The scripts read their configuration from environment variables, and source `testing/.env` if it exists. Copy [`.env.sample`](./.env.sample) to `testing/.env` to get started.

| Variable | Description |
| --- | --- |
| `SAFE_ADDRESS` | Safe under test. Replaces the placeholder Safe. Its first two owners replace the receiver placeholders. |
| `SAFE_API_KEY` | Optional API key for `api.safe.global`, used to read the Safe's nonce and owners from the Safe Transaction Service. Without it, the API allows 1 request per minute. A script run makes one request per chain, so this is enough to test one chain per run. |
| `SAFE_NONCE` | Optional nonce override, applied on every chain. The owners are still read from the Safe Transaction Service. |
| `SAFENET_RELAYER_URL` | Full URL of the Safenet relayer's transaction endpoint (e.g. `https://<proxy>/tx`), the same value as the explorer's relayer setting. Used by `propose-safenet.sh`. |
| `SAFENET_EXPLORER_URL` | Safenet explorer base URL for the printed links. Defaults to `https://safenet-explorer.eth.limo`. |

There is no chain setting: each test transaction is proposed on the chain of its file (`chainId`), for `SAFE_ADDRESS` on that chain, whose nonce and owners are read from the Safe Transaction Service. The Safe must exist on every chain of the files passed to a script, with at least 2 owners. All proposed transactions of a chain share the same nonce, so they are alternatives to each other: executing one invalidates all others.

## Setup

Before proposing the `allowed` and `blocked` sets, the Safe must have paid receivers A and B (its first two owners) once, as in `setup/known-receivers.json`. Until there is a script to queue it, create the setup transaction by hand in Safe{Wallet}:

1. Look up the Safe's first two owners, the first two listed under Settings → Setup → Members.
2. Send 0.01 USDC (USDC.e on Gnosis Chain) to each of them, as one batch in the Transaction Builder or as two "Send" transactions.
3. Have the owners sign and execute the transaction(s).

Only then propose the test cases below, with the Safe's new nonce.

## Propose to Safenet

`propose-safenet.sh` proposes test transaction files directly to Safenet, through the relayer's full-transaction endpoint (`POST $SAFENET_RELAYER_URL`, the endpoint the Safenet explorer posts to). Pass any number of files or directories:

```sh
just testing-propose-safenet testing/transactions/100/allowed testing/transactions/100/blocked testing/transactions/10
```

It needs `SAFE_ADDRESS` and `SAFENET_RELAYER_URL`. Each transaction goes to the chain of its file, so the example above proposes for the Safe on Gnosis Chain and on Optimism. For each file, it prints the case, the expected verdict and the Safenet explorer link of the transaction:

```
transfer-known-receiver
  expected:   secure
  safeTxHash: 0x…
  explorer:   https://safenet-explorer.eth.limo/#/safeTx?chainId=100&safeTxHash=0x…
```

Open the links and compare the Sentinel votes with the expected verdict. The relayer answers every request with an empty `202`, even if it can't parse the transaction, so the explorer link is the only way to confirm that a proposal landed. Only a non-2xx response is reported as an error. The script keeps going after an error and exits non-zero at the end.

The transactions are not added to the Safe Transaction Service, so they don't show up in the Safe{Wallet} queue. The `safeTxHash` is computed locally.
