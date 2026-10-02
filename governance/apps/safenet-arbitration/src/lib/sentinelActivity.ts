import type { Log } from "@safe-global/safe-apps-sdk"
import { type Address, decodeEventLog, encodeEventTopics, type Hex } from "viem"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import type { OracleConfig } from "@/config/oracle"
import { getLogs, type ReadRpc } from "@/lib/rpc"

// One sentinel commitment or revealed vote of a request. Repeated commitments of one sentinel are kept as separate
// events, because the older oracle deployment can emit them and each of them counts towards `committedCount`.
export type SentinelActivity = {
  sentinel: Address
  action: "committed" | "approved" | "denied"
  // The revealed reason, verbatim; `null` for a commitment, which carries none.
  reason: string | null
  transactionHash: Hex
  blockNumber: number
  logIndex: number
}

// The request whose sentinel events are read, and the inclusive block range to read them from.
export type SentinelActivityScope = {
  requestId: Hex
  fromBlock: number
  toBlock: number
}

const REQUEST_ID = /^0x[\da-f]{64}$/i

// topic0 of the two sentinel events, OR-ed together so one `eth_getLogs` call returns both, in chain order. The
// request ID is the next topic, since both events index it first.
const SENTINEL_TOPICS = (["Committed", "Revealed"] as const).map(
  (eventName) => encodeEventTopics({ abi: sentinelOracleAbi, eventName })[0],
)

function assertScope(config: OracleConfig, { requestId, fromBlock, toBlock }: SentinelActivityScope) {
  if (!REQUEST_ID.test(requestId)) {
    throw new Error(`Invalid request ID for sentinel activity: ${requestId}`)
  }
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock)) {
    throw new Error(`Sentinel activity bounds must be safe integers, got ${fromBlock}–${toBlock}`)
  }
  if (fromBlock < config.deploymentBlock) {
    throw new Error(`Sentinel activity starts at block ${fromBlock}, before the oracle deployment block`)
  }
  if (fromBlock > toBlock) {
    throw new Error(`Sentinel activity range ${fromBlock}–${toBlock} is empty`)
  }
}

// Consecutive inclusive ranges of at most `size` blocks covering `[fromBlock, toBlock]`.
function* blockChunks(fromBlock: number, toBlock: number, size: number) {
  for (let start = fromBlock; start <= toBlock; start += size) {
    yield { fromBlock: start, toBlock: Math.min(toBlock, start + size - 1) }
  }
}

// Reject unrelated request/event topics rather than present incomplete evidence.
function toActivity(log: Log, requestId: Hex): SentinelActivity {
  const { eventName, args } = decodeEventLog({
    abi: sentinelOracleAbi,
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data as Hex,
  })
  if (args.requestId.toLowerCase() !== requestId.toLowerCase()) {
    throw new Error(`Sentinel log ${log.transactionHash} belongs to request ${args.requestId}, not ${requestId}`)
  }
  const position = { transactionHash: log.transactionHash as Hex, blockNumber: log.blockNumber, logIndex: log.logIndex }
  if (eventName === "Committed") {
    return { ...position, sentinel: args.sentinel, action: "committed", reason: null }
  }
  if (eventName === "Revealed") {
    return { ...position, sentinel: args.sentinel, action: args.approved ? "approved" : "denied", reason: args.reason }
  }
  throw new Error(`Unexpected oracle event ${eventName} among the sentinel events`)
}

// Every `Committed` and `Revealed` event of one request in `[fromBlock, toBlock]`, oldest first. The range is searched
// in sequential chunks of at most `config.logBlockRange` blocks, and the result is only returned once every chunk was
// read and decoded, so a failure can never leave an evidence list that looks complete but is not.
export async function fetchSentinelActivity(
  rpc: ReadRpc,
  config: OracleConfig,
  scope: SentinelActivityScope,
): Promise<SentinelActivity[]> {
  assertScope(config, scope)
  const events = new Map<string, SentinelActivity>()
  for (const range of blockChunks(scope.fromBlock, scope.toBlock, config.logBlockRange)) {
    const logs = await getLogs(rpc, {
      address: config.oracleAddress,
      ...range,
      topics: [SENTINEL_TOPICS, scope.requestId.toLowerCase() as Hex],
    })
    for (const log of logs) {
      const activity = toActivity(log, scope.requestId)
      events.set(`${activity.transactionHash.toLowerCase()}:${activity.logIndex}`, activity)
    }
  }
  return [...events.values()].sort(
    (left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
  )
}
