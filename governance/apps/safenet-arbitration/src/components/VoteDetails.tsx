import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { AppConfig } from "@/config/app"
import { useRequestVotes } from "@/hooks/useRequestVotes"
import { useSentinelLabels } from "@/hooks/useSentinelLabels"
import { ExternalLink } from "@/components/ExternalLink"
import { AddressValue } from "@/components/HexValue"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { charterReasonLink } from "@/lib/links"

// The votes sentinels revealed on an arbitration request, with the reason each gave (for a denial, the rule the
// transaction violates).
export function VoteDetails({
  sdk,
  config,
  request,
}: {
  sdk: SafeAppsSDK
  config: AppConfig
  request: ArbitrationRequest
}) {
  const { data: votes, error, isPending } = useRequestVotes(sdk, config, request)
  // Names are a convenience: without them (e.g. if the list fails to load), sentinels are just shown by address.
  const { data: labels } = useSentinelLabels(config.sentinelInfoUrl)

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
                <td className="py-1 pr-4">
                  {labels?.get(vote.sentinel) && <span className="mr-2">{labels.get(vote.sentinel)}</span>}
                  <AddressValue
                    chainId={config.chainId}
                    address={vote.sentinel}
                    title={`Revealed in block ${vote.blockNumber}`}
                  />
                </td>
                <td className={`py-1 pr-4 ${vote.approved ? "text-success" : "text-danger"}`}>
                  {vote.approved ? "Secure" : "Insecure"}
                </td>
                <td className="py-1 break-all">
                  <VoteReason reason={vote.reason} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// A vote reason, linking to the Charter rule it cites.
function VoteReason({ reason }: { reason: string }) {
  const link = charterReasonLink(reason)
  if (!link) {
    return reason || <span className="text-muted-foreground">No reason given</span>
  }
  return (
    <ExternalLink href={link.url} title={link.title}>
      {reason}
    </ExternalLink>
  )
}
