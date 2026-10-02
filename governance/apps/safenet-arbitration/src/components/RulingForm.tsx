import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useId, useState } from "react"
import type { Hex } from "viem"
import type { OracleConfig } from "@/config/oracle"
import { useChainInfo } from "@/hooks/useChainInfo"
import { rulingMutationKey, useSubmitRuling } from "@/hooks/useSubmitRuling"
import { RULING_LABELS, type Ruling, type SubmittedRuling } from "@/lib/rulings"

const SAFE_QUEUE_URL = "https://app.safe.global/transactions/queue"

// Safe{Wallet}'s queue for the Safe that was actually submitted to. The chain metadata is only used for the chain the
// proposal was returned for, and never decides whether the proposal itself succeeded.
function safeQueueUrl(chain: { chainId: string; shortName: string } | undefined, queued: SubmittedRuling) {
  if (!chain?.shortName || chain.chainId !== String(queued.chainId)) {
    return undefined
  }
  const params = new URLSearchParams({ safe: `${chain.shortName}:${queued.safeAddress}` })
  return `${SAFE_QUEUE_URL}?${params}`
}

function RulingButtons({ pending, canSubmit, onClose }: { pending: boolean; canSubmit: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Waiting for Safe{Wallet}…" : "Submit to Safe"}
      </button>
    </div>
  )
}

// Only a queued proposal exists at this point: the owners still have to confirm and execute it, and the request stays
// open until its contract state says otherwise.
function QueuedFeedback({
  queued,
  queueUrl,
  onClose,
}: {
  queued: SubmittedRuling
  queueUrl: string | undefined
  onClose: () => void
}) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-success">
        Ruling queued in {"Safe{Wallet}"}. It is not executed yet: owners confirm and execute it from the Safe's
        transaction queue.
      </p>
      <p>
        Safe transaction hash: <span className="font-mono break-all">{queued.safeTxHash}</span>
      </p>
      <p className="text-muted-foreground">
        A ruling only settles sentinel consequences. It does not authorize the original transaction and does not revive
        an attestation for it. The request stays listed until a refresh shows it closed.
      </p>
      <div className="flex items-center justify-end gap-2">
        {queueUrl && (
          <a
            href={queueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1 hover:bg-subtle"
          >
            Open in Safe Wallet
          </a>
        )}
        <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1 hover:bg-subtle">
          Close
        </button>
      </div>
    </div>
  )
}

export function RulingForm({
  sdk,
  config,
  safe,
  readReady,
  evidenceReady,
  requestId,
  ruling,
  onClose,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  safe: SafeInfo
  readReady: boolean
  evidenceReady: boolean
  requestId: Hex
  ruling: Ruling
  onClose: () => void
}) {
  const titleId = useId()
  const [context, setContext] = useState("")
  const queryClient = useQueryClient()
  const mutationKey = rulingMutationKey(config)
  // Any ruling proposal of this oracle counts, also one started by a form that has since been replaced.
  const pending = useIsMutating({ mutationKey }) > 0
  const { mutate, data: queued, error, isSuccess } = useSubmitRuling(sdk, config)
  const { data: chain } = useChainInfo(sdk, config)
  const rationale = context.trim()
  // Submission needs a successful latest list read, a Safe that can sign and, for the rulings that rely on it, the
  // case's verified evidence. Out of scope stays available without evidence, but never without a rationale.
  const canSubmit =
    readReady && safe.isReadOnly === false && rationale !== "" && (ruling === "outOfScope" || evidenceReady)

  // Handlers read the cache itself: `pending` only follows after a re-render, so a second event dispatched in the
  // same tick would still see the old value.
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    // A form can also be submitted without its button, so every gate is checked again here.
    if (canSubmit && queryClient.isMutating({ mutationKey }) === 0) {
      mutate({ requestId, ruling, context: rationale, expectedSafeAddress: safe.safeAddress, evidenceReady })
    }
  }
  const close = () => {
    if (queryClient.isMutating({ mutationKey }) === 0) {
      onClose()
    }
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={titleId} className="rounded border border-border-subtle bg-surface p-4">
      <h3 id={titleId} className="mb-3 font-semibold">
        {RULING_LABELS[ruling]}
      </h3>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-muted-foreground">Rationale (recorded on-chain)</span>
        <textarea
          value={context}
          onChange={(event) => setContext(event.target.value)}
          disabled={pending || isSuccess}
          rows={3}
          className="w-full rounded border border-border p-2 text-sm disabled:bg-subtle"
        />
      </label>
      {error && <p className="mb-3 text-sm text-danger">Failed to submit ruling: {error.message}</p>}
      {isSuccess ? (
        <QueuedFeedback queued={queued} queueUrl={safeQueueUrl(chain, queued)} onClose={close} />
      ) : (
        <RulingButtons pending={pending} canSubmit={canSubmit} onClose={close} />
      )}
    </form>
  )
}
