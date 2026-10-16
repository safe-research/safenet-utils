import { Cog6ToothIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"
import { AddressChip } from "@/components/AddressChip"
import { SettingsDialog } from "@/components/SettingsDialog"
import { useOracleConfig } from "@/hooks/useOracleConfig"
import { useSafeAppsSdk } from "@/hooks/useSafeAppsSdk"

function App() {
  const { sdk, connection } = useSafeAppsSdk()
  const { config, setSettings } = useOracleConfig()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <main className="mx-auto max-w-4xl p-6 font-sans">
      {connection.status === "connecting" && <p className="text-muted-foreground">Connecting to {"Safe{Wallet}"}…</p>}
      {connection.status === "unavailable" && (
        <p className="text-danger">
          Not running inside {"Safe{Wallet}"}. Open this app as a custom Safe App from the arbitrator Safe.
        </p>
      )}
      {connection.status === "connected" && (
        <>
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Arbitration</h1>
            <div className="flex items-center gap-3">
              <AddressChip chainId={config.chainId} address={config.oracleAddress} />
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
                className="rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground"
              >
                <Cog6ToothIcon aria-hidden="true" className="size-6" />
              </button>
            </div>
          </div>
          {settingsOpen && (
            <SettingsDialog
              activeChainId={connection.safe.chainId}
              settings={{ chainId: config.chainId, oracleAddress: config.oracleAddress }}
              onSave={setSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}
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
