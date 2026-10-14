import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { OracleConfig } from "@/config/oracle"
import { useRequestVotes } from "@/hooks/useRequestVotes"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"

// The votes sentinels revealed on an arbitration request, with the reason each gave (for a denial, the rule the
// transaction violates).
export function VoteDetails({
  sdk,
  config,
  request,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  request: ArbitrationRequest
}) {
  const { data: votes, error, isPending } = useRequestVotes(sdk, config, request)

  if (isPending) {
    return <p className="text-muted-foreground">Loading sentinel votes…</p>
  }
  if (error) {
    return <p className="text-danger">Failed to load sentinel votes: {error.message}</p>
  }

  return (
    <section aria-label="Sentinel votes">
      <h3 className="mb-2 font-semibold">Sentinel votes</h3>
      {votes.length === 0 ? (
        <p className="text-muted-foreground">No revealed votes were found.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-normal">Sentinel</th>
              <th className="py-1 pr-4 font-normal">Vote</th>
              <th className="py-1 font-normal">Reason</th>
            </tr>
          </thead>
          <tbody>
            {votes.map((vote) => (
              <tr key={vote.sentinel} className="align-top">
                <td className="py-1 pr-4 font-mono break-all" title={`Revealed in block ${vote.blockNumber}`}>
                  {vote.sentinel}
                </td>
                <td className={`py-1 pr-4 ${vote.approved ? "text-success" : "text-danger"}`}>
                  {vote.approved ? "Approve" : "Deny"}
                </td>
                <td className="py-1 break-all">
                  {vote.reason || <span className="text-muted-foreground">No reason given</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
