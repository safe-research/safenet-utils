import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { OracleConfig } from "@/config/oracle"
import { useArbitrationRequests } from "@/hooks/useArbitrationRequests"

function shorten(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}

export function ArbitrationRequestList({ sdk, config }: { sdk: SafeAppsSDK; config: OracleConfig }) {
  const { data, error, isPending, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useArbitrationRequests(sdk, config)
  const requests = data?.requests

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
              <th className="py-2 font-normal">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.requestId} className="border-b border-gray-100">
                <td className="py-2 font-mono" title={request.requestId}>
                  {shorten(request.requestId)}
                </td>
                <td className="py-2 font-mono" title={request.sponsor}>
                  {shorten(request.sponsor)}
                </td>
                <td className="py-2">
                  {request.approveCount} / {request.denyCount}
                </td>
                <td className="py-2">block {request.arbitrationDeadline.toString()}</td>
              </tr>
            ))}
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
