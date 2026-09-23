# Safenet Arbitration Safe App

A [Safe App](https://github.com/safe-global/safe-apps-sdk) for the Safe that holds a Safenet `SentinelOracle`'s
`ARBITRATOR` role. Loaded inside Safe{Wallet} while connected as that Safe, it will list disputed (`FROZEN`)
requests and queue `resolveDispute`/`markOutOfScope` rulings, which the Safe's owners then confirm and execute
through Safe{Wallet}'s normal multisig flow.

> [!NOTE]
> Work in progress: currently only an app shell that connects to Safe{Wallet} and shows the connected Safe. See
> [the epic plan](../../../epics/2026_09_23_arbitration_safe_app.md).

The app talks to chain state exclusively through `@safe-global/safe-apps-sdk`, so it has no wallet connector or
RPC configuration of its own. It only accepts SDK messages from `https://app.safe.global` (see
[`src/safe/sdk.ts`](./src/safe/sdk.ts)).

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
