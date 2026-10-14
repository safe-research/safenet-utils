import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { ReactNode } from "react"
import type { OracleConfig } from "@/config/oracle"
import { useRequestProposal } from "@/hooks/useRequestProposal"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"

// `Enum.Operation` of the Safe contracts.
const OPERATION_LABELS: Record<number, string> = { 0: "Call", 1: "DelegateCall" }

// The Safe transaction an arbitration request was posted for, as proposed to `Consensus`.
export function ProposalDetails({
  sdk,
  config,
  request,
}: {
  sdk: SafeAppsSDK
  config: OracleConfig
  request: ArbitrationRequest
}) {
  const { data: proposal, error, isPending } = useRequestProposal(sdk, config, request)

  if (isPending) {
    return <p className="text-muted-foreground">Loading proposed transaction…</p>
  }
  if (error) {
    return <p className="text-danger">Failed to load proposed transaction: {error.message}</p>
  }
  if (proposal === null) {
    return <p className="text-danger">No proposal matching this request was found.</p>
  }

  const { transaction } = proposal
  const rows: [string, ReactNode][] = [
    ["Safe tx hash", proposal.safeTxHash],
    ["Chain ID", transaction.chainId.toString()],
    ["Safe", transaction.safe],
    ["To", transaction.to],
    ["Value", `${transaction.value} wei`],
    [
      "Operation",
      <span className={transaction.operation === 1 ? "text-danger" : undefined}>
        {OPERATION_LABELS[transaction.operation] ?? `Unknown (${transaction.operation})`}
      </span>,
    ],
    ["Data", <span className="block max-h-40 overflow-y-auto">{transaction.data}</span>],
    ["Nonce", transaction.nonce.toString()],
    ["Safe tx gas", transaction.safeTxGas.toString()],
    ["Base gas", transaction.baseGas.toString()],
    ["Gas price", transaction.gasPrice.toString()],
    ["Gas token", transaction.gasToken],
    ["Refund receiver", transaction.refundReceiver],
    ["Epoch", proposal.epoch.toString()],
    ["Oracle data", proposal.oracleData],
    ["Proposed in", `block ${proposal.blockNumber} (${proposal.transactionHash})`],
  ]

  return (
    <section aria-label="Proposed transaction">
      <h3 className="mb-2 font-semibold">Proposed transaction</h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
