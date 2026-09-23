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
    <form onSubmit={onSubmit} className="rounded border border-gray-200 bg-white p-4">
      <h3 className="mb-3 font-semibold">{RULING_LABELS[ruling]} ruling</h3>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-gray-500">Rationale (recorded on-chain)</span>
        <textarea
          value={context}
          onChange={(event) => setContext(event.target.value)}
          disabled={isPending || isSuccess}
          rows={3}
          className="w-full rounded border border-gray-300 p-2 text-sm disabled:bg-gray-50"
        />
      </label>
      {error && <p className="mb-3 text-sm text-red-600">Failed to submit ruling: {error.message}</p>}
      {isSuccess ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-green-700">
            Ruling queued in {"Safe{Wallet}"} as{" "}
            <span className="font-mono break-all" title={data.safeTxHash}>
              {shorten(data.safeTxHash)}
            </span>
            . Owners confirm and execute it from the Safe's transaction queue.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
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
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || rationale === ""}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isPending ? "Waiting for Safe{Wallet}…" : "Submit to Safe"}
          </button>
        </div>
      )}
    </form>
  )
}
