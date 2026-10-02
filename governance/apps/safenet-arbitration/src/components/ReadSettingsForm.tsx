import { type SyntheticEvent, useState } from "react"
import { parseReadSettings, type ReadSettings } from "@/lib/readSettings"

export function ReadSettingsForm({
  value,
  disabled,
  onApply,
}: {
  value: ReadSettings
  disabled: boolean
  onApply: (settings: ReadSettings) => Promise<void>
}) {
  const [lookback, setLookback] = useState(value.lookbackBlocks?.toString() ?? "")
  const [rpcUrl, setRpcUrl] = useState(value.rpcUrl)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || applying) return
    setError(undefined)
    setApplying(true)
    try {
      await onApply(parseReadSettings(lookback, rpcUrl))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the read settings")
    } finally {
      setApplying(false)
    }
  }

  return (
    <details className="mb-4 rounded border border-border p-3">
      <summary className="cursor-pointer font-semibold">Search settings</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        {value.lookbackBlocks === null
          ? "From oracle deployment"
          : `Last ${value.lookbackBlocks.toLocaleString()} blocks`}
        {" · "}
        {value.rpcUrl ? "Custom RPC" : "Safe Wallet RPC"}
      </p>
      <form onSubmit={submit} aria-label="Search settings" className="mt-3">
        <fieldset disabled={disabled || applying} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">Lookback blocks</span>
            <input
              type="number"
              min="1"
              step="1"
              value={lookback}
              onChange={(event) => setLookback(event.target.value)}
              placeholder="All history"
              className="w-full rounded border border-border p-2 text-sm disabled:bg-subtle"
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Clear this field to search from the oracle deployment. A shorter window excludes older disputes.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm">Custom RPC URL (optional)</span>
            <input
              type="url"
              value={rpcUrl}
              onChange={(event) => setRpcUrl(event.target.value)}
              placeholder="Use Safe Wallet RPC"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded border border-border p-2 text-sm disabled:bg-subtle"
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Use a trusted RPC with browser CORS access for historical logs. Safe Wallet still supplies current state and
            proposals. Clear the URL to use Safe Wallet for logs too. Settings stay in this tab.
          </p>
          <button
            type="submit"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
          >
            {applying ? "Checking RPC…" : "Apply settings"}
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </details>
  )
}
