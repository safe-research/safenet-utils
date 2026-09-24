import { useSafeAppsSdk } from "@/safe/useSafeAppsSdk"

function App() {
  const { connection } = useSafeAppsSdk()

  return (
    <main className="mx-auto max-w-4xl p-6 font-sans text-gray-900">
      <h1 className="mb-4 text-2xl font-semibold">Arbitration</h1>
      {connection.status === "connecting" && <p className="text-gray-500">Connecting to {"Safe{Wallet}"}…</p>}
      {connection.status === "unavailable" && (
        <p className="text-red-600">
          Not running inside {"Safe{Wallet}"}. Open this app as a custom Safe App from the arbitrator Safe.
        </p>
      )}
      {connection.status === "connected" && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-gray-500">Safe</dt>
          <dd className="font-mono break-all">{connection.safe.safeAddress}</dd>
          <dt className="text-gray-500">Chain ID</dt>
          <dd className="font-mono">{connection.safe.chainId}</dd>
        </dl>
      )}
    </main>
  )
}

export default App
