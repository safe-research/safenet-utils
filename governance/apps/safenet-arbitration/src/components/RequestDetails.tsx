import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useState } from "react"
import { RulingForm } from "@/components/RulingForm"
import type { OracleConfig } from "@/config/oracle"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { RULING_LABELS, RULINGS, type Ruling } from "@/lib/rulings"

// Expanded view of a single request awaiting arbitration, holding the actions the arbitrator can take on it.
export function RequestDetails({
  sdk,
  config,
  request,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  request: ArbitrationRequest
}) {
  const [ruling, setRuling] = useState<Ruling>()

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Rule:</span>
        {RULINGS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRuling(option)}
            aria-pressed={ruling === option}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 aria-pressed:bg-gray-200"
          >
            {RULING_LABELS[option]}
          </button>
        ))}
      </div>
      {ruling && (
        <RulingForm
          // Remount per ruling, so switching rulings starts from a clean form.
          key={ruling}
          sdk={sdk}
          config={config}
          requestId={request.requestId}
          ruling={ruling}
          onClose={() => setRuling(undefined)}
        />
      )}
    </div>
  )
}
