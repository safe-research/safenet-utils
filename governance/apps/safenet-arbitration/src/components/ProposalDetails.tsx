import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { ReactNode } from "react"
import { ExternalLink } from "@/components/ExternalLink"
import { AddressValue, HexValue, SafeTxHashValue, SafeValue, TxHashValue } from "@/components/HexValue"
import type { OracleConfig } from "@/config/oracle"
import { useRequestProposal } from "@/hooks/useRequestProposal"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { explorerBlockUrl } from "@/lib/links"
import { truncateHex } from "@/lib/format"

// `Enum.Operation` of the Safe contracts.
const OPERATION_LABELS: Record<number, string> = { 0: "Call", 1: "DelegateCall" }

// Calldata can be arbitrarily long, so only its start is shown; the copy button still copies all of it.
const DATA_PREVIEW_BYTES = 100

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
  // The Safe transaction can be for any chain, while the proposal itself happened on the oracle's chain.
  const data = truncateHex(transaction.data, DATA_PREVIEW_BYTES)
  const rows: [string, ReactNode][] = [
    [
      "Safe tx hash",
      <SafeTxHashValue chainId={transaction.chainId} safe={transaction.safe} safeTxHash={proposal.safeTxHash} />,
    ],
    ["Chain ID", transaction.chainId.toString()],
    ["Safe", <SafeValue chainId={transaction.chainId} safe={transaction.safe} />],
    ["To", <AddressValue chainId={transaction.chainId} address={transaction.to} />],
    ["Value", `${transaction.value} wei`],
    [
      "Operation",
      <span className={transaction.operation === 1 ? "text-danger" : undefined}>
        {OPERATION_LABELS[transaction.operation] ?? `Unknown (${transaction.operation})`}
      </span>,
    ],
    [
      "Data",
      <HexValue
        value={transaction.data}
        display={data}
        title={data === transaction.data ? undefined : `${(transaction.data.length - 2) / 2} bytes`}
      />,
    ],
    ["Nonce", transaction.nonce.toString()],
    ["Safe tx gas", transaction.safeTxGas.toString()],
    ["Base gas", transaction.baseGas.toString()],
    ["Gas price", transaction.gasPrice.toString()],
    ["Gas token", <AddressValue chainId={transaction.chainId} address={transaction.gasToken} />],
    ["Refund receiver", <AddressValue chainId={transaction.chainId} address={transaction.refundReceiver} />],
    ["Epoch", proposal.epoch.toString()],
    ["Oracle data", <HexValue value={proposal.oracleData} />],
    [
      "Proposed in",
      <>
        block{" "}
        <ExternalLink href={explorerBlockUrl(config.chainId, proposal.blockNumber)}>
          {proposal.blockNumber}
        </ExternalLink>{" "}
        (
        <TxHashValue chainId={config.chainId} hash={proposal.transactionHash} />)
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
