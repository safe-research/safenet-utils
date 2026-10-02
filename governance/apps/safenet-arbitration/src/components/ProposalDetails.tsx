import type { ReactNode } from "react"
import type { RequestProposal } from "@/lib/requestProposal"

// `Enum.Operation` of the Safe contracts.
const OPERATION_LABELS: Record<number, string> = { 0: "Call", 1: "DelegateCall" }

const TX_HASH_PLACEHOLDER = "{{txHash}}"

// The EVM transaction that proposed the request, linked through the chain's explorer template when it has one.
function SourceTransaction({ hash, template }: { hash: string; template?: string }) {
  if (!template?.includes(TX_HASH_PLACEHOLDER)) {
    return <>{hash}</>
  }
  return (
    <a
      href={template.replaceAll(TX_HASH_PLACEHOLDER, hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      {hash}
    </a>
  )
}

// The Safe transaction an arbitration request was posted for, as proposed to `Consensus`. The transaction belongs to
// its own (original) chain, which need not be the arbitration chain. `txHashTemplate` is a validated explorer URL
// template for the arbitration chain's EVM transaction hashes; the Safe transaction hash is never linked as one.
export function ProposalDetails({ proposal, txHashTemplate }: { proposal: RequestProposal; txHashTemplate?: string }) {
  const { transaction } = proposal
  const rows: [string, ReactNode][] = [
    ["Safe tx hash", proposal.safeTxHash],
    ["Original chain ID", transaction.chainId.toString()],
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
    [
      "Proposed in",
      <>
        block {proposal.blockNumber} (<SourceTransaction hash={proposal.transactionHash} template={txHashTemplate} />)
      </>,
    ],
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
