import { shorten } from "@/lib/format"
import type { SentinelActivity as SentinelEvent } from "@/lib/sentinelActivity"

const ACTION_LABELS: Record<SentinelEvent["action"], string> = {
  committed: "Committed",
  approved: "Revealed: approve",
  denied: "Revealed: deny",
}

// The transaction that emitted an event: a block explorer link when the chain's explorer URL template is known,
// otherwise the plain hash. React escapes the text of a reason or hash, so nothing a sentinel supplies is interpreted.
function SourceTransaction({ hash, template }: { hash: string; template: string | undefined }) {
  if (template === undefined) {
    return <span title={hash}>{shorten(hash)}</span>
  }
  return (
    <a
      href={template.replaceAll("{{txHash}}", hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      className="underline underline-offset-2"
    >
      {shorten(hash)}
    </a>
  )
}

function Reason({ reason }: { reason: string | null }) {
  if (reason === null) {
    return <span className="text-muted-foreground">—</span>
  }
  if (reason === "") {
    return <span className="text-muted-foreground">No reason supplied</span>
  }
  return <span className="break-words whitespace-pre-wrap">{reason}</span>
}

// What the sentinels did on a request, one row per `Committed` or `Revealed` event in chain order. A sentinel that
// committed more than once, or committed and never revealed, shows exactly that.
export function SentinelActivity({ activity, txHashTemplate }: { activity: SentinelEvent[]; txHashTemplate?: string }) {
  return (
    <section aria-label="Sentinel activity">
      <h3 className="mb-2 font-semibold">Sentinel activity</h3>
      {activity.length === 0 ? (
        <p className="text-muted-foreground">No sentinel activity was recorded for this request.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Sentinel</th>
              <th className="py-1 font-normal">Action</th>
              <th className="py-1 font-normal">Reason</th>
              <th className="py-1 font-normal">Source transaction</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((event) => (
              <tr key={`${event.transactionHash}:${event.logIndex}`} className="border-b border-divider align-top">
                <td className="py-1 pr-3 font-mono" title={event.sentinel}>
                  {shorten(event.sentinel)}
                </td>
                <td className="py-1 pr-3">{ACTION_LABELS[event.action]}</td>
                <td className="py-1 pr-3">
                  <Reason reason={event.reason} />
                </td>
                <td className="py-1 font-mono">
                  <SourceTransaction hash={event.transactionHash} template={txHashTemplate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
