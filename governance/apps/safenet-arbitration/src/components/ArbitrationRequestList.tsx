import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { Fragment, useState } from "react"
import type { Hex } from "viem"
import { RequestDetails } from "@/components/RequestDetails"
import type { OracleConfig } from "@/config/oracle"
import { useArbitrationRequests } from "@/hooks/useArbitrationRequests"
import { shorten } from "@/lib/format"

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
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {isPending && <p className="text-gray-500">Loading arbitration requests…</p>}
      {error && <p className="text-red-600">Failed to load arbitration requests: {error.message}</p>}
      {requests && requests.length === 0 && (
        <p className="text-gray-500">No requests are awaiting arbitration in the searched blocks.</p>
      )}
      {requests && requests.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2 font-normal">Request ID</th>
              <th className="py-2 font-normal">Sponsor</th>
              <th className="py-2 font-normal">Approve / Deny</th>
              <th className="py-2 text-right font-normal">Deadline</th>
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
                    className={`cursor-pointer hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-gray-400 ${
                      isExpanded ? "bg-gray-50" : "border-b border-gray-100"
                    }`}
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
                    <td className="py-2 text-right">block {request.arbitrationDeadline.toString()}</td>
                  </tr>
                  {isExpanded && (
                    <tr id={detailsId} className="border-b border-gray-100 bg-gray-50">
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
        <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
          <span>Searched back to block {data.searchedFromBlock}</span>
          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetching}
              className="rounded border border-gray-300 px-3 py-1 text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
