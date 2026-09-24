import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { type FormEvent, useState } from "react"
import type { Hex } from "viem"
import type { OracleConfig } from "@/config/oracle"
import { useSubmitRuling } from "@/hooks/useSubmitRuling"
import { shorten } from "@/lib/format"
import { RULING_LABELS, type Ruling } from "@/lib/rulings"

export function RulingForm({
  sdk,
  config,
  requestId,
  ruling,
  onClose,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  requestId: Hex
  ruling: Ruling
  onClose: () => void
}) {
  const [context, setContext] = useState("")
  const { mutate, data, error, isPending, isSuccess } = useSubmitRuling(sdk, config)
  const rationale = context.trim()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutate({ requestId, ruling, context: rationale })
  }

  return (
    <form onSubmit={onSubmit} className="rounded border border-border-subtle bg-surface p-4">
      <h3 className="mb-3 font-semibold">{RULING_LABELS[ruling]} ruling</h3>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-muted-foreground">Rationale (recorded on-chain)</span>
        <textarea
          value={context}
          onChange={(event) => setContext(event.target.value)}
          disabled={isPending || isSuccess}
          rows={3}
          className="w-full rounded border border-border p-2 text-sm disabled:bg-subtle"
        />
      </label>
      {error && <p className="mb-3 text-sm text-danger">Failed to submit ruling: {error.message}</p>}
      {isSuccess ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-success">
            Ruling queued in {"Safe{Wallet}"} as{" "}
            <span className="font-mono break-all" title={data.safeTxHash}>
              {shorten(data.safeTxHash)}
            </span>
            . Owners confirm and execute it from the Safe's transaction queue.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || rationale === ""}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {isPending ? "Waiting for Safe{Wallet}…" : "Submit to Safe"}
          </button>
        </div>
      )}
    </form>
  )
}
