import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { config } from "@/config/oracle"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"
import { useArbitrator } from "@/hooks/useArbitrator"
import { useSafeAppsSdk } from "@/hooks/useSafeAppsSdk"

type SafeProps = { sdk: SafeAppsSDK; safe: SafeInfo }

// Shows the requests only once the oracle itself confirms that the connected Safe is its arbitrator. A read-only
// session of that Safe may review requests, but the list withholds every ruling from it.
function ArbitratorGate({ sdk, safe }: SafeProps) {
  const { status, data: arbitrator, error, refetch } = useArbitrator(sdk, config, safe)

  if (status === "pending") {
    return <p className="text-muted-foreground">Verifying that this Safe is the oracle's arbitrator…</p>
  }
  if (status === "error") {
    return (
      <div>
        <p className="mb-2 text-danger">Could not verify the oracle's arbitrator: {error.message}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle"
        >
          Retry
        </button>
      </div>
    )
  }
  if (arbitrator.toLowerCase() !== safe.safeAddress.toLowerCase()) {
    return (
      <p className="text-danger">
        This Safe is not the arbitrator of the sentinel oracle. Open this app from the arbitrator Safe{" "}
        <span className="font-mono break-all">{arbitrator}</span>.
      </p>
    )
  }
  return (
    <>
      {safe.isReadOnly !== false && (
        <p className="mb-4 text-muted-foreground">
          This Safe is open read-only: you can review requests, but rulings can only be proposed by an owner of the
          Safe.
        </p>
      )}
      <ArbitrationRequestList
        key={`${safe.chainId}:${safe.safeAddress.toLowerCase()}`}
        sdk={sdk}
        config={config}
        safe={safe}
      />
    </>
  )
}

function ConnectedSafe({ sdk, safe }: SafeProps) {
  return (
    <>
      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Safe</dt>
        <dd className="font-mono break-all">{safe.safeAddress}</dd>
        <dt className="text-muted-foreground">Chain ID</dt>
        <dd className="font-mono">{safe.chainId}</dd>
        <dt className="text-muted-foreground">Sentinel oracle</dt>
        <dd className="font-mono break-all">{config.oracleAddress}</dd>
      </dl>
      {safe.chainId === config.chainId ? (
        <ArbitratorGate sdk={sdk} safe={safe} />
      ) : (
        <p className="text-danger">
          This app is configured for the sentinel oracle on chain {config.chainId}. Switch to a Safe on that chain.
        </p>
      )}
    </>
  )
}

function App() {
  const { sdk, connection } = useSafeAppsSdk()

  return (
    <main className="mx-auto max-w-4xl p-6 font-sans">
      <h1 className="mb-4 text-2xl font-semibold">Arbitration</h1>
      {connection.status === "connecting" && <p className="text-muted-foreground">Connecting to {"Safe{Wallet}"}…</p>}
      {connection.status === "unavailable" && (
        <p className="text-danger">
          The connection to {"Safe{Wallet}"} is unavailable. Open this app as a custom Safe App from the arbitrator
          Safe; the connection is re-checked automatically.
        </p>
      )}
      {connection.status === "connected" && <ConnectedSafe sdk={sdk} safe={connection.safe} />}
    </main>
  )
}

export default App
