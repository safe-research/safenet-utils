import { config } from "@/config/oracle"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"
import { useSafeAppsSdk } from "@/hooks/useSafeAppsSdk"

function App() {
  const { sdk, connection } = useSafeAppsSdk()

  return (
    <main className="mx-auto max-w-4xl p-6 font-sans">
      <h1 className="mb-4 text-2xl font-semibold">Arbitration</h1>
      {connection.status === "connecting" && <p className="text-muted-foreground">Connecting to {"Safe{Wallet}"}…</p>}
      {connection.status === "unavailable" && (
        <p className="text-danger">
          Not running inside {"Safe{Wallet}"}. Open this app as a custom Safe App from the arbitrator Safe.
        </p>
      )}
      {connection.status === "connected" && (
        <>
          <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Safe</dt>
            <dd className="font-mono break-all">{connection.safe.safeAddress}</dd>
            <dt className="text-muted-foreground">Chain ID</dt>
            <dd className="font-mono">{connection.safe.chainId}</dd>
            <dt className="text-muted-foreground">Sentinel oracle</dt>
            <dd className="font-mono break-all">{config.oracleAddress}</dd>
          </dl>
          {connection.safe.chainId === config.chainId ? (
            <ArbitrationRequestList sdk={sdk} config={config} />
          ) : (
            <p className="text-danger">
              This app is configured for the sentinel oracle on chain {config.chainId}. Switch to a Safe on that chain.
            </p>
          )}
        </>
      )}
    </main>
  )
}

export default App
