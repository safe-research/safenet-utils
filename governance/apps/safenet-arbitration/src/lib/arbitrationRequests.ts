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
  // Last block sentinels could reveal their votes in; see `fetchRequestVotes`.
  revealDeadline: bigint
  approveCount: number
  denyCount: number
  // Block number after which the arbitrator can no longer rule and anyone may call `timeoutArbitration`.
  arbitrationDeadline: bigint
  // Estimated Unix timestamp of `arbitrationDeadline`; see `estimateBlockTimestamp`. Unset if no estimate is possible.
  arbitrationDeadlineAt?: number
  // Block the request's dispute was triggered in, i.e. it entered arbitration, and that block's Unix timestamp.
  disputedBlock: number
  disputedAt: number
}

export type BlockTime = { number: number; timestamp: number }

export type ArbitrationRequestsPage = {
  requests: ArbitrationRequest[]
  // Oldest block searched; pass it as `previousFrom` to continue with the next (older) page. `0` means the search
  // reached genesis.
  fromBlock: number
  // Chain head when the page was fetched, for telling how far away deadlines are.
  latest: BlockTime
}

const DISPUTE_EVENTS = ["DisputeTriggered", "DisputeResolved", "DisputeOutOfScope", "ArbitrationTimedOut"] as const

// topic0 of every dispute lifecycle event, OR-ed together so a single `eth_getLogs` call returns all of them.
const DISPUTE_TOPICS = DISPUTE_EVENTS.map((eventName) => encodeEventTopics({ abi: sentinelOracleAbi, eventName })[0])

export type OpenDispute = { requestId: Hex; blockNumber: number }

// Requests that had a dispute triggered and not (yet) settled by a ruling, an out-of-scope decline or an arbitration
// timeout, with the block their dispute was triggered in, in the order their disputes were triggered. `logs` must be in
// chain order, as returned by `eth_getLogs`.
export function openDisputes(logs: Pick<Log, "topics" | "data" | "blockNumber">[]): OpenDispute[] {
  // Keyed by request ID; a `Map` keeps insertion order.
  const open = new Map<Hex, number>()
  for (const log of logs) {
    const { eventName, args } = decodeEventLog({
      abi: sentinelOracleAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data as Hex,
    })
    if (eventName === "DisputeTriggered") {
      // `Number` also covers a raw hex quantity, which the SDK may pass through despite its `number` type.
      open.set(args.requestId, Number(log.blockNumber))
    } else {
      open.delete(args.requestId)
    }
  }
  return [...open].map(([requestId, blockNumber]) => ({ requestId, blockNumber }))
}

// Block `block`'s number and Unix timestamp. `Number` also covers raw hex quantities, which the SDK may pass through
// despite its `number` types.
export async function getBlockTime(sdk: SafeAppsSDK, block: number | "latest"): Promise<BlockTime> {
  const { number, timestamp } = await sdk.eth.getBlockByNumber([block])
  return { number: Number(number), timestamp: Number(timestamp) }
}

// Estimates when `blockNumber` is (or was) mined, extrapolating from the average block time between the known blocks
// `a` and `b`. Without two distinct known blocks there is no block time to go by.
export function estimateBlockTimestamp(blockNumber: number, a: BlockTime, b: BlockTime): number | undefined {
  if (a.number === b.number) {
    return undefined
  }
  const secondsPerBlock = (b.timestamp - a.timestamp) / (b.number - a.number)
  return Math.round(b.timestamp + (blockNumber - b.number) * secondsPerBlock)
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
  // Also the reference for estimating deadlines, so it's fetched for every page.
  const latest = await getBlockTime(sdk, "latest")
  // `previousFrom` itself was already searched by the previous page.
  const toBlock = previousFrom !== undefined ? previousFrom - 1 : latest.number
  const fromBlock = Math.max(toBlock - config.logBlockRange + 1, 0)
  const logs = await sdk.eth.getPastLogs([
    { address: config.oracleAddress, fromBlock, toBlock, topics: [DISPUTE_TOPICS] },
  ])
  const candidates = await Promise.all(
    openDisputes(logs)
      .toReversed()
      .map(async (dispute) => ({
        ...dispute,
        request: await getRequest(sdk, config.oracleAddress, dispute.requestId),
      })),
  )
  const frozen = candidates.filter(({ request }) => request.progress.state === RequestState.FROZEN)
  const requests = await Promise.all(
    frozen.map(async ({ requestId, blockNumber, request }) => {
      const disputed = await getBlockTime(sdk, blockNumber)
      return {
        requestId,
        sponsor: request.terms.sponsor,
        commitDeadline: request.terms.commitDeadline,
        revealDeadline: request.terms.revealDeadline,
        approveCount: request.progress.approveSentinelCount,
        denyCount: request.progress.denySentinelCount,
        arbitrationDeadline: request.progress.arbitrationDeadline,
        arbitrationDeadlineAt: estimateBlockTimestamp(Number(request.progress.arbitrationDeadline), disputed, latest),
        disputedBlock: blockNumber,
        disputedAt: disputed.timestamp,
      }
    }),
  )
  return { requests, fromBlock, latest }
}
