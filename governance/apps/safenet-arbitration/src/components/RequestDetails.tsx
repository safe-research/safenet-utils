import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { type UseQueryResult, useIsMutating, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ProposalDetails } from "@/components/ProposalDetails"
import { RulingForm } from "@/components/RulingForm"
import { SentinelActivity } from "@/components/SentinelActivity"
import type { OracleConfig } from "@/config/oracle"
import { useChainInfo } from "@/hooks/useChainInfo"
import { useRequestProposal } from "@/hooks/useRequestProposal"
import { useSentinelActivity } from "@/hooks/useSentinelActivity"
import { rulingMutationKey } from "@/hooks/useSubmitRuling"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import type { RequestProposal } from "@/lib/requestProposal"
import type { ReadSource } from "@/lib/rpc"
import { RULING_LABELS, RULINGS, type Ruling } from "@/lib/rulings"
import type { SentinelActivity as SentinelEvent } from "@/lib/sentinelActivity"

function EvidenceNotice({
  label,
  message,
  onRetry,
  failed = false,
}: {
  label: string
  message: string
  onRetry?: () => void
  failed?: boolean
}) {
  return (
    <section aria-label={label}>
      <h3 className="mb-2 font-semibold">{label}</h3>
      <p className={failed ? "text-danger" : "text-muted-foreground"}>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 rounded border border-border px-2 py-1">
          Retry
        </button>
      )}
    </section>
  )
}

function ProposalEvidence({
  query,
  txHashTemplate,
}: {
  query: UseQueryResult<RequestProposal | null>
  txHashTemplate?: string
}) {
  if (query.isPending) {
    return <EvidenceNotice label="Proposed transaction" message="Loading proposed transaction…" />
  }
  if (query.isError) {
    return (
      <EvidenceNotice
        label="Proposed transaction"
        message={`Failed to load proposed transaction: ${query.error.message}`}
        failed
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!query.data) {
    return (
      <EvidenceNotice
        label="Proposed transaction"
        message="No proposal matching this request was found."
        failed
        onRetry={() => void query.refetch()}
      />
    )
  }
  return <ProposalDetails proposal={query.data} txHashTemplate={txHashTemplate} />
}

function completeActivity(activity: SentinelEvent[] | undefined, request: ArbitrationRequest): boolean {
  if (!activity) return false
  const counts = { committed: 0, approved: 0, denied: 0 }
  for (const event of activity) counts[event.action]++
  return (
    counts.committed === request.committedCount &&
    counts.approved + counts.denied === request.revealedCount &&
    counts.approved === request.approveCount &&
    counts.denied === request.denyCount
  )
}

function verifiedEvidence(
  proposal: UseQueryResult<RequestProposal | null>,
  activity: UseQueryResult<SentinelEvent[]>,
  complete: boolean,
) {
  return (
    proposal.isSuccess &&
    !proposal.isFetching &&
    Boolean(proposal.data) &&
    activity.isSuccess &&
    !activity.isFetching &&
    complete
  )
}

function SentinelEvidence({
  query,
  enabled,
  complete,
  txHashTemplate,
}: {
  query: UseQueryResult<SentinelEvent[]>
  enabled: boolean
  complete: boolean
  txHashTemplate?: string
}) {
  if (!enabled) {
    return (
      <EvidenceNotice label="Sentinel activity" message="Verify the proposed transaction to load sentinel evidence." />
    )
  }
  if (query.isPending) {
    return <EvidenceNotice label="Sentinel activity" message="Loading sentinel evidence…" />
  }
  if (query.isError) {
    return (
      <EvidenceNotice
        label="Sentinel activity"
        message={`Failed to load sentinel evidence: ${query.error.message}`}
        failed
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (!complete || !query.data) {
    return (
      <EvidenceNotice
        label="Sentinel activity"
        message="Sentinel evidence is incomplete or inconsistent."
        failed
        onRetry={() => void query.refetch()}
      />
    )
  }
  return <SentinelActivity activity={query.data} txHashTemplate={txHashTemplate} />
}

// The rulings on offer. Choosing is locked while a proposal is being created, so its form cannot be swapped out.
function RulingChoices({
  selected,
  isAllowed,
  locked,
  onChoose,
}: {
  selected: Ruling | undefined
  isAllowed: (ruling: Ruling) => boolean
  locked: boolean
  onChoose: (ruling: Ruling) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">Rule:</span>
      {RULINGS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChoose(option)}
          disabled={locked || !isAllowed(option)}
          aria-pressed={selected === option}
          className="rounded border border-border px-2 py-0.5 hover:bg-subtle aria-pressed:bg-selected disabled:opacity-50"
        >
          {RULING_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

export function RequestDetails({
  sdk,
  source,
  config,
  request,
  safe,
  readReady,
  generation,
  lookbackBlocks,
}: {
  sdk: SafeAppsSDK
  source: ReadSource
  config: OracleConfig
  request: ArbitrationRequest
  safe: SafeInfo
  readReady: boolean
  generation: number
  lookbackBlocks: number | null
}) {
  const [ruling, setRuling] = useState<Ruling>()
  const queryClient = useQueryClient()
  const mutationKey = rulingMutationKey(config)
  const pending = useIsMutating({ mutationKey }) > 0
  const evidenceSource = { rpc: source.rpc, key: JSON.stringify([source.key, lookbackBlocks]) }
  const proposal = useRequestProposal(sdk, evidenceSource, config, request, generation)
  const scope = proposal.data
    ? { requestId: request.requestId, fromBlock: proposal.data.blockNumber, toBlock: request.triggerBlock }
    : undefined
  const activity = useSentinelActivity(evidenceSource, config, scope, generation)
  const complete = completeActivity(activity.data, request)
  const evidenceReady = verifiedEvidence(proposal, activity, complete)
  const { data: chain } = useChainInfo(sdk, config)
  const txHashTemplate = chain?.blockExplorerUriTemplate.txHash || undefined
  // Rulings need the latest list read and a Safe that can sign; the ones that rely on evidence also need the case's.
  const isAllowed = (option: Ruling) =>
    readReady && safe.isReadOnly === false && (option === "outOfScope" || evidenceReady)

  const choose = (option: Ruling) => {
    // The cache is read directly: `pending` only follows after a re-render, so a click dispatched in the same tick as
    // a submit would still see the old value.
    if (isAllowed(option) && queryClient.isMutating({ mutationKey }) === 0) {
      setRuling(option)
    }
  }

  return (
    <div className="space-y-3">
      <ProposalEvidence query={proposal} txHashTemplate={txHashTemplate} />
      <SentinelEvidence query={activity} enabled={Boolean(scope)} complete={complete} txHashTemplate={txHashTemplate} />
      <RulingChoices selected={ruling} isAllowed={isAllowed} locked={pending} onChoose={choose} />
      <p className="text-sm text-muted-foreground">
        A ruling settles sentinel consequences. It does not authorize the original transaction and does not revive an
        attestation for it.
      </p>
      {ruling && (
        <RulingForm
          key={ruling}
          sdk={sdk}
          config={config}
          safe={safe}
          readReady={readReady}
          evidenceReady={evidenceReady}
          requestId={request.requestId}
          ruling={ruling}
          onClose={() => setRuling(undefined)}
        />
      )}
    </div>
  )
}
