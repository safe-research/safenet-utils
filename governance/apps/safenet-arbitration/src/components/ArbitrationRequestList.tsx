import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import { Fragment, type ReactNode, useState } from "react"
import { RequestDetails } from "@/components/RequestDetails"
import { ReadSettingsForm } from "@/components/ReadSettingsForm"
import type { OracleConfig } from "@/config/oracle"
import { isSearchComplete, useArbitrationRequests } from "@/hooks/useArbitrationRequests"
import { rulingMutationKey } from "@/hooks/useSubmitRuling"
import type { ArbitrationRequest, ArbitrationRequestsSnapshot } from "@/lib/arbitrationRequests"
import { shorten } from "@/lib/format"
import { createReadSource, DEFAULT_LOOKBACK_BLOCKS, type ReadSettings, WALLET_SOURCE_KEY } from "@/lib/readSettings"
import type { ReadSource } from "@/lib/rpc"

const COLUMN_COUNT = 4

// The block ranges the search has not covered yet: older history, and blocks mined after the newest searched one.
function unsearchedRanges(snapshot: ArbitrationRequestsSnapshot): string[] {
  const ranges: string[] = []
  if (snapshot.historyToBlock !== null) {
    ranges.push(`${snapshot.searchFromBlock}–${snapshot.historyToBlock}`)
  }
  if (snapshot.liveThroughBlock < snapshot.observedBlock) {
    ranges.push(`${snapshot.liveThroughBlock + 1}–${snapshot.observedBlock}`)
  }
  return ranges
}

function ReadError({
  error,
  snapshot,
  isFetching,
  onRetry,
}: {
  error: Error
  snapshot: ArbitrationRequestsSnapshot | undefined
  isFetching: boolean
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      aria-label="Arbitration requests could not be read"
      className="mb-3 flex items-center justify-between gap-4"
    >
      <div className="text-danger">
        <p>Failed to load arbitration requests: {error.message}</p>
        {snapshot && (
          <p>
            Showing the last successful read, at block {snapshot.observedBlock}. Rulings are unavailable until a read
            succeeds.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={isFetching}
        className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
      >
        Retry
      </button>
    </div>
  )
}

// An empty list only means "none" once every block has been searched, and only if the latest read succeeded.
function Coverage({
  snapshot,
  failed,
  deploymentBlock,
}: {
  snapshot: ArbitrationRequestsSnapshot
  failed: boolean
  deploymentBlock: number
}) {
  if (!isSearchComplete(snapshot)) {
    return (
      <p className="mb-3 text-muted-foreground">
        Partial result: requests are still being searched for, so some may be missing. Blocks not searched yet:{" "}
        {unsearchedRanges(snapshot).join(", ")}.
      </p>
    )
  }
  if (snapshot.requests.length === 0 && !failed) {
    return (
      <p className="text-muted-foreground">
        {snapshot.searchFromBlock > deploymentBlock
          ? "No requests were found in the selected block window. Older disputes may exist."
          : "No requests are awaiting arbitration."}
      </p>
    )
  }
  return null
}

function RequestRow({
  request,
  observedBlock,
  isExpanded,
  locked,
  onToggle,
  details,
}: {
  request: ArbitrationRequest
  observedBlock: number
  isExpanded: boolean
  // A ruling proposal is pending: the row cannot be toggled, so the form waiting for Safe{Wallet} stays in place.
  locked: boolean
  onToggle: () => void
  details: ReactNode
}) {
  const detailsId = `request-details-${request.requestId}`
  const interaction = locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-subtle"
  const surface = isExpanded ? "bg-subtle" : "border-b border-divider"
  return (
    <Fragment>
      <tr
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggle()
          }
        }}
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? detailsId : undefined}
        aria-disabled={locked}
        className={`${interaction} focus-visible:outline-2 focus-visible:outline-focus ${surface}`}
      >
        <td className="py-2 font-mono" title={request.requestId}>
          {shorten(request.requestId)}
        </td>
        <td className="py-2 font-mono" title={request.sponsor}>
          {shorten(request.sponsor)}
        </td>
        <td className="py-2">
          {request.approveCount} / {request.denyCount}
        </td>
        <td className="py-2 text-right">
          block {request.arbitrationDeadline.toString()}
          {/* The timeout becomes callable after the deadline block, never at it. A FROZEN request stays rulable. */}
          {BigInt(observedBlock) > request.arbitrationDeadline && (
            <span className="block text-danger">Timeout available</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr id={detailsId} className="border-b border-divider bg-subtle">
          <td colSpan={COLUMN_COUNT} className="px-3 pb-3">
            {details}
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function RequestsView({
  sdk,
  source,
  config,
  safe,
  snapshot,
  error,
  lookbackBlocks,
}: {
  sdk: SafeAppsSDK
  source: ReadSource
  config: OracleConfig
  safe: SafeInfo
  snapshot: ArbitrationRequestsSnapshot
  error: Error | null
  lookbackBlocks: number | null
}) {
  // One request is expanded at a time, so its details and actions sit right below its row.
  const [expanded, setExpanded] = useState<ArbitrationRequest>()
  const queryClient = useQueryClient()
  const mutationKey = rulingMutationKey(config)
  const locked = useIsMutating({ mutationKey }) > 0
  const outsideWindow = expanded && expanded.triggerBlock < snapshot.searchFromBlock
  const requests = outsideWindow ? [expanded, ...snapshot.requests] : snapshot.requests
  if (expanded && !outsideWindow && !snapshot.requests.some((request) => request.requestId === expanded.requestId)) {
    setExpanded(undefined)
  }

  const toggle = (request: ArbitrationRequest) => {
    // Collapsing or switching rows would discard the form of a ruling that is waiting for Safe{Wallet}. The cache is
    // read directly: `locked` only follows after a re-render, so an event in the same tick as a submit would miss it.
    if (queryClient.isMutating({ mutationKey }) === 0) {
      setExpanded(expanded?.requestId === request.requestId ? undefined : request)
    }
  }

  return (
    <>
      <Coverage snapshot={snapshot} failed={Boolean(error)} deploymentBlock={config.deploymentBlock} />
      {outsideWindow && (
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          The selected request is outside the current search window. Close it to remove it.
        </p>
      )}
      {requests.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle text-muted-foreground">
            <tr>
              <th className="py-2 font-normal">Request ID</th>
              <th className="py-2 font-normal">Sponsor</th>
              <th className="py-2 font-normal">Approve / Deny</th>
              <th className="py-2 text-right font-normal">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <RequestRow
                key={request.requestId}
                request={request}
                observedBlock={snapshot.observedBlock}
                isExpanded={expanded?.requestId === request.requestId}
                locked={locked}
                onToggle={() => toggle(request)}
                details={
                  <RequestDetails
                    // A rescan after a chain reorganization discards the old history's evidence and form state.
                    key={snapshot.generation}
                    sdk={sdk}
                    source={source}
                    config={config}
                    lookbackBlocks={lookbackBlocks}
                    request={request}
                    safe={safe}
                    generation={snapshot.generation}
                    // Rulings need the latest read to have succeeded; rows from a failed refresh stay inspectable.
                    readReady={!error && request.triggerBlock >= snapshot.searchFromBlock}
                  />
                }
              />
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-sm text-muted-foreground">Checked through block {snapshot.observedBlock}</p>
      <p className="text-sm text-muted-foreground">
        Search range: blocks {snapshot.searchFromBlock}–{snapshot.observedBlock}.
      </p>
    </>
  )
}

export function ArbitrationRequestList({
  sdk,
  config,
  safe,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  safe: SafeInfo
}) {
  const queryClient = useQueryClient()
  const mutationKey = rulingMutationKey(config)
  const locked = useIsMutating({ mutationKey }) > 0
  const [applied, setApplied] = useState<{ settings: ReadSettings; customSource?: ReadSource }>({
    settings: { lookbackBlocks: DEFAULT_LOOKBACK_BLOCKS, rpcUrl: "" },
  })
  const source = applied.customSource ?? { rpc: sdk, key: WALLET_SOURCE_KEY }
  const { data, error, isPending, isFetching, refresh } = useArbitrationRequests(
    sdk,
    source,
    config,
    safe.safeAddress,
    applied.settings.lookbackBlocks,
  )
  const apply = async (settings: ReadSettings) => {
    if (queryClient.isMutating({ mutationKey }) > 0)
      throw new Error("Wait for the pending ruling before changing settings")
    const checked = await createReadSource(sdk, config, settings)
    if (queryClient.isMutating({ mutationKey }) > 0)
      throw new Error("Wait for the pending ruling before changing settings")
    setApplied({ settings, customSource: settings.rpcUrl ? checked : undefined })
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Arbitration requests</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <ReadSettingsForm value={applied.settings} disabled={locked} onApply={apply} />
      {isPending && <p className="text-muted-foreground">Loading arbitration requests…</p>}
      {error && <ReadError error={error} snapshot={data} isFetching={isFetching} onRetry={refresh} />}
      {data && (
        <RequestsView
          key={`${source.key}:${applied.settings.lookbackBlocks}`}
          sdk={sdk}
          source={source}
          config={config}
          safe={safe}
          snapshot={data}
          error={error}
          lookbackBlocks={applied.settings.lookbackBlocks}
        />
      )}
    </section>
  )
}
