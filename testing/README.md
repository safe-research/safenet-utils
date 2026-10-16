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

## Environment

The scripts read their configuration from environment variables, and source `testing/.env` if it exists. Copy [`.env.sample`](./.env.sample) to `testing/.env` to get started.

| Variable | Description |
| --- | --- |
| `SAFE_ADDRESS` | Safe under test. Replaces the placeholder Safe. Its first two owners replace the receiver placeholders. |
| `CHAIN_ID` | Chain ID of the Safe (`1`, `100` or `42161`). Selects the Safe Transaction Service network. |
| `SAFE_API_KEY` | API key for `api.safe.global`, used to read the Safe's nonce and owners from the Safe Transaction Service. |
| `SAFE_NONCE` | Optional nonce override. The owners are still read from the Safe Transaction Service. |

The Safe must have at least 2 owners. All proposed transactions share the same nonce, so they are alternatives to each other: executing one invalidates all others.
