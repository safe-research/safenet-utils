import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { Log } from "@safe-global/safe-apps-sdk"
import {
  type Address,
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  type Hex,
} from "viem"
import type { OracleConfig } from "@/config/oracle"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"

export type ArbitrationRequest = {
  requestId: Hex
  sponsor: Address
  // Block number the request's commit window closes at; see `fetchRequestProposal`.
  commitDeadline: bigint
  approveCount: number
  denyCount: number
  // Block number after which the arbitrator can no longer rule and anyone may call `timeoutArbitration`.
  arbitrationDeadline: bigint
}

export type ArbitrationRequestsPage = {
  requests: ArbitrationRequest[]
  // Oldest block searched; pass it as `previousFrom` to continue with the next (older) page. `0` means the search
  // reached genesis.
  fromBlock: number
}

const DISPUTE_EVENTS = ["DisputeTriggered", "DisputeResolved", "DisputeOutOfScope", "ArbitrationTimedOut"] as const

// topic0 of every dispute lifecycle event, OR-ed together so a single `eth_getLogs` call returns all of them.
const DISPUTE_TOPICS = DISPUTE_EVENTS.map((eventName) => encodeEventTopics({ abi: sentinelOracleAbi, eventName })[0])

// Request IDs that had a dispute triggered and not (yet) settled by a ruling, an out-of-scope decline or an
// arbitration timeout, in the order their disputes were triggered. `logs` must be in chain order, as returned by
// `eth_getLogs`.
export function openDisputeIds(logs: Pick<Log, "topics" | "data">[]): Hex[] {
  const open = new Set<Hex>()
  for (const log of logs) {
    const { eventName, args } = decodeEventLog({
      abi: sentinelOracleAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data as Hex,
    })
    if (eventName === "DisputeTriggered") {
      open.add(args.requestId)
    } else {
      open.delete(args.requestId)
    }
  }
  return [...open]
}

export async function ethCall(sdk: SafeAppsSDK, to: Address, data: Hex): Promise<Hex> {
  return (await sdk.eth.call([{ to, data }])) as Hex
}

async function getRequest(sdk: SafeAppsSDK, oracleAddress: Address, requestId: Hex) {
  const result = await ethCall(
    sdk,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "getRequest", args: [requestId] }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "getRequest", data: result })
}

// Lists the oracle's currently `FROZEN` requests whose dispute was triggered in the `config.logBlockRange` blocks just
// before `previousFrom` (or up to the latest block, if not given), most recently disputed first, so consecutive pages
// form one newest-first list.
// Logs only narrow down which request IDs to look at; each candidate's current on-chain state is authoritative, so a
// dispute settled after the searched blocks is still filtered out.
export async function fetchArbitrationRequests(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  previousFrom?: number,
): Promise<ArbitrationRequestsPage> {
  // `previousFrom` itself was already searched by the previous page.
  const toBlock = previousFrom !== undefined ? previousFrom - 1 : (await sdk.eth.getBlockByNumber(["latest"])).number
  const fromBlock = Math.max(toBlock - config.logBlockRange + 1, 0)
  const logs = await sdk.eth.getPastLogs([
    { address: config.oracleAddress, fromBlock, toBlock, topics: [DISPUTE_TOPICS] },
  ])
  const candidates = await Promise.all(
    openDisputeIds(logs)
      .toReversed()
      .map(async (requestId) => ({
        requestId,
        request: await getRequest(sdk, config.oracleAddress, requestId),
      })),
  )
  const requests = candidates
    .filter(({ request }) => request.progress.state === RequestState.FROZEN)
    .map(({ requestId, request }) => ({
      requestId,
      sponsor: request.terms.sponsor,
      commitDeadline: request.terms.commitDeadline,
      approveCount: request.progress.approveSentinelCount,
      denyCount: request.progress.denySentinelCount,
      arbitrationDeadline: request.progress.arbitrationDeadline,
    }))
  return { requests, fromBlock }
}
