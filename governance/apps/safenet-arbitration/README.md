# Safenet Arbitration Safe App

A [Safe App](https://github.com/safe-global/safe-apps-sdk) for the Safe that holds a Safenet `SentinelOracle`'s
`ARBITRATOR` role. Loaded inside Safe{Wallet} while connected as that Safe, it will list disputed (`FROZEN`)
requests and queue `resolveDispute`/`markOutOfScope` rulings, which the Safe's owners then confirm and execute
through Safe{Wallet}'s normal multisig flow.

> [!NOTE]
> Work in progress: currently lists `FROZEN` requests awaiting arbitration, but cannot yet queue rulings. See
> [the epic plan](../../../epics/2026_09_23_arbitration_safe_app.md).

The app talks to chain state exclusively through `@safe-global/safe-apps-sdk`, so it has no wallet connector or
RPC configuration of its own. It only accepts SDK messages from `https://app.safe.global` (see
[`src/lib/safe.ts`](./src/lib/safe.ts)).

## Configuration

The `SentinelOracle` to operate on is fixed at build time through Vite environment variables, documented in
[`.env.sample`](./.env.sample). Unset or empty variables default to the current Gnosis Chain testnet deployment; copy
the file to `.env` to point the app at a different deployment.

Requests awaiting arbitration are found by querying the oracle's dispute events (`DisputeTriggered` minus
`DisputeResolved`/`DisputeOutOfScope`/`ArbitrationTimedOut`), then confirming each candidate is still `FROZEN` with
`getRequest`. Logs are searched in pages of `VITE_LOG_BLOCK_RANGE` blocks, starting at the latest block and newest
dispute first; **Load older** extends the search one page further back.

## Developing

From the repository root:

```sh
just deps                        # npm ci
just safenet-arbitration-app-dev # Vite dev server
```

To load the dev build in Safe{Wallet}, open a Safe on <https://app.safe.global>, go to **Apps → My custom apps →
Add custom Safe App**, and enter the dev server URL (e.g. `http://localhost:5173`). The dev server sends the CORS
and `frame-ancestors` headers Safe{Wallet} needs to fetch `manifest.json` and frame the app.

`just build`, `just check`, `just fix` and `just test` cover this package alongside the rest of the repository;
inside this directory, the equivalent `npm run build|check|fix|test` scripts work too.
