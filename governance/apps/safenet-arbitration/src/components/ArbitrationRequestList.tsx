import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { Fragment, useState } from "react"
import type { Hex } from "viem"
import { HexValue } from "@/components/HexValue"
import { RequestDetails } from "@/components/RequestDetails"
import type { OracleConfig } from "@/config/oracle"
import { useArbitrationRequests } from "@/hooks/useArbitrationRequests"
import { formatRelativeTime, formatTimestamp, shorten } from "@/lib/format"
import type { ArbitrationRequest, BlockTime } from "@/lib/arbitrationRequests"

const COLUMN_COUNT = 4

export function ArbitrationRequestList({ sdk, config }: { sdk: SafeAppsSDK; config: OracleConfig }) {
  const { data, error, isPending, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useArbitrationRequests(sdk, config)
  const requests = data?.requests
  // One request is expanded at a time, so its details and actions sit right below its row.
  const [expanded, setExpanded] = useState<Hex>()

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Arbitration requests</h2>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {isPending && <p className="text-muted-foreground">Loading arbitration requests…</p>}
      {error && <p className="text-danger">Failed to load arbitration requests: {error.message}</p>}
      {requests && requests.length === 0 && (
        <p className="text-muted-foreground">No requests are awaiting arbitration in the searched blocks.</p>
      )}
      {requests && requests.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle text-muted-foreground">
            <tr>
              <th className="py-2 font-normal">Request ID</th>
              <th className="py-2 font-normal">In arbitration since</th>
              <th className="py-2 font-normal">Secure / Insecure</th>
              <th className="py-2 text-right font-normal">Rule by</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const isExpanded = expanded === request.requestId
              const detailsId = `request-details-${request.requestId}`
              const toggle = () => setExpanded(isExpanded ? undefined : request.requestId)
              return (
                <Fragment key={request.requestId}>
                  <tr
                    onClick={toggle}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        toggle()
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? detailsId : undefined}
                    className={`cursor-pointer hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus ${
                      isExpanded ? "bg-subtle" : "border-b border-divider"
                    }`}
                  >
                    <td className="py-2" title={request.requestId}>
                      <HexValue value={request.requestId} display={shorten(request.requestId)} />
                    </td>
                    <td
                      className="py-2"
                      title={`Block ${request.disputedBlock}, ${new Date(request.disputedAt * 1000).toISOString()}`}
                    >
                      {formatTimestamp(request.disputedAt)}
                    </td>
                    <td className="py-2">
                      {request.approveCount} / {request.denyCount}
                    </td>
                    <RuleByCell request={request} latest={data.latest} />
                  </tr>
                  {isExpanded && (
                    <tr id={detailsId} className="border-b border-divider bg-subtle">
                      <td colSpan={COLUMN_COUNT} className="px-3 pb-3">
                        <RequestDetails sdk={sdk} config={config} request={request} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {data && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Searched back to block {data.searchedFromBlock}</span>
          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetching}
              className="rounded border border-border px-3 py-1 text-foreground hover:bg-subtle disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// The last block a ruling can be executed in, as an estimated local time and how far away it is from the `latest`
// block; the block is shown on hover. Without an estimate, only the block is shown.
function RuleByCell({ request, latest }: { request: ArbitrationRequest; latest: BlockTime }) {
  const block = `block ${request.arbitrationDeadline}`
  const estimate = request.arbitrationDeadlineAt
  if (estimate === undefined) {
    return <td className="py-2 text-right">{block}</td>
  }
  const passed = request.arbitrationDeadline < BigInt(latest.number)
  return (
    <td className="py-2 text-right" title={`${block}, estimated ${new Date(estimate * 1000).toISOString()}`}>
      ~{formatTimestamp(estimate)}{" "}
      <span className={passed ? "text-danger" : "text-muted-foreground"}>
        ({formatRelativeTime(estimate, latest.timestamp)})
      </span>
    </td>
  )
}
