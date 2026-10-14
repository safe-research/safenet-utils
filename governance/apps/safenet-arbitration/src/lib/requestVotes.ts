import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { type Address, decodeEventLog, encodeEventTopics, type Hex, type Log as ViemLog } from "viem"
import type { OracleConfig } from "@/config/oracle"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"

// A sentinel's revealed vote on a request.
export type SentinelVote = {
  sentinel: Address
  approved: boolean
  bondAmount: bigint
  // Why the sentinel voted the way it did, e.g. the rule a denied transaction violates.
  reason: string
  blockNumber: number
  transactionHash: Hex
}

// The revealed votes on `request`, in reveal order. `SentinelOracle.reveal` only accepts reveals after
// `commitDeadline` and up to `revealDeadline`, so that window holds every `Revealed` event of the request.
export async function fetchRequestVotes(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  request: Pick<ArbitrationRequest, "requestId" | "commitDeadline" | "revealDeadline">,
): Promise<SentinelVote[]> {
  const logs = await sdk.eth.getPastLogs([
    {
      address: config.oracleAddress,
      fromBlock: Number(request.commitDeadline) + 1,
      toBlock: Number(request.revealDeadline),
      topics: encodeEventTopics({
        abi: sentinelOracleAbi,
        eventName: "Revealed",
        args: { requestId: request.requestId },
      }),
    },
  ])
  return logs.map((log) => {
    const { args } = decodeEventLog({
      abi: sentinelOracleAbi,
      eventName: "Revealed",
      topics: log.topics as ViemLog["topics"],
      data: log.data as Hex,
    })
    return {
      sentinel: args.sentinel,
      approved: args.approved,
      bondAmount: args.bondAmount,
      reason: args.reason,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash as Hex,
    }
  })
}
