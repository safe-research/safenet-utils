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
import { ethCall, getBlockHeader, getLogs, type ReadRpc, type RpcBlockHeader } from "@/lib/rpc"

// A dispute that no event has settled yet, with the position of its trigger log.
export type OpenDispute = {
  requestId: Hex
  triggerBlock: number
  triggerLogIndex: number
}

export type ArbitrationRequest = OpenDispute & {
  commitDeadline: bigint
  sponsor: Address
  approveCount: number
  denyCount: number
  committedCount: number
  revealedCount: number
  // Timeout becomes callable after this block; rulings remain valid while FROZEN.
  arbitrationDeadline: bigint
}

export type ArbitrationRequestsSnapshot = {
  // The oracle's FROZEN requests as of `observedBlock`, most recently disputed first. Only disputes triggered at or
  // after `searchFromBlock` are listed.
  requests: ArbitrationRequest[]
  // Lowest block of the discovery window: the deployment block, or the oldest block of the requested lookback.
  searchFromBlock: number
  // Next older block to search for disputes; `null` once `searchFromBlock` was searched.
  historyToBlock: number | null
  // Newest block whose dispute logs were searched. It trails `observedBlock` while catching up.
  liveThroughBlock: number
  // Block (and its hash) at which every request in `requests` was read.
  observedBlock: number
  observedBlockHash: Hex
  // Changes only when the chain history this snapshot was built from was replaced, which invalidates anything derived
  // from it.
  generation: number
}

export type FetchArbitrationRequestsOptions = {
  // The latest successful snapshot. Without it (or after a chain reset) the scan restarts at the chain head.
  previous?: ArbitrationRequestsSnapshot
  signal?: AbortSignal
  // Discover disputes in the newest N blocks only, the head included, and never before the deployment block. The
  // window rolls forward with the head. Omitted or `null` searches the whole deployment history.
  lookbackBlocks?: number | null
  // Where dispute logs are read from; defaults to the first reader. Heads, hashes and every request's state always come
  // from the first reader, so a log source can only nominate candidates, never vouch for their state.
  logsRpc?: ReadRpc
}

type BlockRange = { fromBlock: number; toBlock: number }

// What survives of the previous snapshot, and the generation the next one belongs to.
type ScanBase = { previous: ArbitrationRequestsSnapshot | undefined; generation: number }

// At most one older page and one newer page are searched per step.
type ScanPlan = {
  history: BlockRange | null
  forward: BlockRange | null
  historyToBlock: number | null
  liveThroughBlock: number
}

type StateReads = {
  // Rows that were already read at the observed block.
  kept: ArbitrationRequest[]
  read: OpenDispute[]
}

const SETTLEMENT_EVENTS = ["DisputeResolved", "DisputeOutOfScope", "ArbitrationTimedOut"] as const

const DISPUTE_EVENTS = ["DisputeTriggered", ...SETTLEMENT_EVENTS] as const

// topic0 of every dispute lifecycle event, OR-ed together so a single `eth_getLogs` call returns all of them.
const DISPUTE_TOPICS = DISPUTE_EVENTS.map((eventName) => encodeEventTopics({ abi: sentinelOracleAbi, eventName })[0])

// Match Wallet's three-call RPC batches and leave capacity for its other reads.
const REQUEST_BATCH_SIZE = 3
const REQUEST_BATCH_DELAY_MS = 350

// Disputes that were triggered and not (yet) settled by a ruling, an out-of-scope decline or an arbitration timeout,
// in the order they were triggered. `logs` must be unique and in chain order, as returned by `getLogs`. Any other
// event is an error, so a future oracle event can never be mistaken for a settlement.
export function openDisputes(logs: Log[]): OpenDispute[] {
  const open = new Map<Hex, OpenDispute>()
  for (const log of logs) {
    const { eventName, args } = decodeEventLog({
      abi: sentinelOracleAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data as Hex,
    })
    // A trigger (re)opens the dispute at its newest position; any settlement closes it.
    open.delete(args.requestId)
    if (eventName === "DisputeTriggered") {
      const { blockNumber: triggerBlock, logIndex: triggerLogIndex } = log
      open.set(args.requestId, { requestId: args.requestId, triggerBlock, triggerLogIndex })
    } else if (!SETTLEMENT_EVENTS.some((settlement) => settlement === eventName)) {
      throw new Error(`Unexpected oracle event ${eventName} in the dispute lifecycle`)
    }
  }
  return [...open.values()]
}

export async function getRequest(
  rpc: ReadRpc,
  oracleAddress: Address,
  requestId: Hex,
  block: number | "latest" = "latest",
) {
  const result = await ethCall(
    rpc,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "getRequest", args: [requestId] }),
    { block },
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "getRequest", data: result })
}

function throwIfAborted(signal: AbortSignal | undefined) {
  signal?.throwIfAborted()
}

function assertLookback(lookbackBlocks: number | null | undefined) {
  if (lookbackBlocks != null && !(Number.isSafeInteger(lookbackBlocks) && lookbackBlocks > 0)) {
    throw new RangeError(`The lookback must be a positive safe integer number of blocks, got ${lookbackBlocks}`)
  }
}

// The oldest block that can hold a listed dispute: `lookbackBlocks` blocks ending at the head, or the deployment block.
function discoveryStart(config: OracleConfig, head: number, lookbackBlocks: number | null | undefined): number {
  return lookbackBlocks == null ? config.deploymentBlock : Math.max(config.deploymentBlock, head - lookbackBlocks + 1)
}

// Keeps the previous snapshot unless its observed block is gone from the chain: the head regressed below it, or another
// block now has its height. Only a header read that succeeded can prove either, so a failing read rejects.
async function resolveBase(
  rpc: ReadRpc,
  head: RpcBlockHeader,
  previous: ArbitrationRequestsSnapshot | undefined,
): Promise<ScanBase> {
  if (!previous) return { previous, generation: 0 }
  const reset = { previous: undefined, generation: previous.generation + 1 }
  if (head.number < previous.observedBlock) return reset
  const observed = head.number === previous.observedBlock ? head : await getBlockHeader(rpc, previous.observedBlock)
  const unchanged = observed.hash === previous.observedBlockHash.toLowerCase()
  return unchanged ? { previous, generation: previous.generation } : reset
}

function pageEndingAt(config: OracleConfig, toBlock: number, searchFrom: number): BlockRange {
  return { fromBlock: Math.max(toBlock - config.logBlockRange + 1, searchFrom), toBlock }
}

function historyRange(
  config: OracleConfig,
  head: number,
  searchFrom: number,
  previous: ArbitrationRequestsSnapshot | undefined,
): BlockRange | null {
  if (!previous) return pageEndingAt(config, head, searchFrom)
  // A finished walk reached the previous bound; a window that grew since leaves the blocks below it unsearched.
  const next = previous.historyToBlock ?? previous.searchFromBlock - 1
  return next < searchFrom ? null : pageEndingAt(config, next, searchFrom)
}

function forwardRange(
  config: OracleConfig,
  head: number,
  searchFrom: number,
  previous: ArbitrationRequestsSnapshot | undefined,
): BlockRange | null {
  if (!previous || previous.liveThroughBlock >= head) return null
  // Blocks that already left a rolling window can't hold a listed dispute; skip them rather than search and discard.
  const fromBlock = Math.max(previous.liveThroughBlock + 1, searchFrom)
  return { fromBlock, toBlock: Math.min(head, fromBlock + config.logBlockRange - 1) }
}

function planScan(
  config: OracleConfig,
  head: number,
  searchFrom: number,
  previous: ArbitrationRequestsSnapshot | undefined,
): ScanPlan {
  const history = historyRange(config, head, searchFrom, previous)
  const forward = forwardRange(config, head, searchFrom, previous)
  return {
    history,
    forward,
    historyToBlock: history && history.fromBlock > searchFrom ? history.fromBlock - 1 : null,
    liveThroughBlock: forward ? forward.toBlock : (previous?.liveThroughBlock ?? head),
  }
}

async function readDisputes(logsRpc: ReadRpc, config: OracleConfig, range: BlockRange | null) {
  if (!range) return []
  return openDisputes(await getLogs(logsRpc, { address: config.oracleAddress, ...range, topics: [DISPUTE_TOPICS] }))
}

// Rows already read at the head block are current. A newer head may have settled any other row, so those are read
// again together with the newly found disputes. Rows disputed before the window are dropped unread.
function planStateReads(
  previous: ArbitrationRequestsSnapshot | undefined,
  head: RpcBlockHeader,
  searchFrom: number,
  found: OpenDispute[],
): StateReads {
  const rows = (previous?.requests ?? []).filter(({ triggerBlock }) => triggerBlock >= searchFrom)
  const known = new Set(rows.map(({ requestId }) => requestId))
  const added = new Map<Hex, OpenDispute>()
  for (const dispute of found) {
    if (!known.has(dispute.requestId)) added.set(dispute.requestId, dispute)
  }
  return previous?.observedBlock === head.number
    ? { kept: rows, read: [...added.values()] }
    : { kept: [], read: [...rows, ...added.values()] }
}

// The request's state at `block`, or `null` once it is no longer awaiting arbitration. Overdue requests stay: timeout
// being callable doesn't settle them.
async function readOpenRequest(
  rpc: ReadRpc,
  oracleAddress: Address,
  dispute: OpenDispute,
  block: number,
): Promise<ArbitrationRequest | null> {
  const { terms, progress } = await getRequest(rpc, oracleAddress, dispute.requestId, block)
  if (progress.state !== RequestState.FROZEN) return null
  return {
    requestId: dispute.requestId,
    triggerBlock: dispute.triggerBlock,
    triggerLogIndex: dispute.triggerLogIndex,
    commitDeadline: terms.commitDeadline,
    sponsor: terms.sponsor,
    approveCount: progress.approveSentinelCount,
    denyCount: progress.denySentinelCount,
    committedCount: progress.committedCount,
    revealedCount: progress.revealedCount,
    arbitrationDeadline: progress.arbitrationDeadline,
  }
}

function newestTriggerFirst(left: OpenDispute, right: OpenDispute): number {
  return right.triggerBlock - left.triggerBlock || right.triggerLogIndex - left.triggerLogIndex
}

async function readOpenRequests(
  rpc: ReadRpc,
  oracleAddress: Address,
  { kept, read }: StateReads,
  block: number,
  signal: AbortSignal | undefined,
): Promise<ArbitrationRequest[]> {
  const requests = [...kept]
  for (let start = 0; start < read.length; start += REQUEST_BATCH_SIZE) {
    if (start > 0) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, REQUEST_BATCH_DELAY_MS)
      await promise
    }
    signal?.throwIfAborted()
    const batch = read.slice(start, start + REQUEST_BATCH_SIZE)
    const states = await Promise.all(batch.map((dispute) => readOpenRequest(rpc, oracleAddress, dispute, block)))
    signal?.throwIfAborted()
    requests.push(...states.filter((state) => state !== null))
  }
  return requests.sort(newestTriggerFirst)
}

// One step of the scan: the newest unsearched blocks and one older page, together with the state of every request that
// is still open at the chain head. Nothing is published unless every read succeeded against one unchanged head block,
// so a failed step can simply be repeated from `options.previous`. The discovery window is recomputed from the head on
// every step: it never reaches below the deployment block, drops disputes that fell out of a rolling lookback, and
// searches blocks that a larger lookback newly brought in.
export async function fetchArbitrationRequests(
  rpc: ReadRpc,
  config: OracleConfig,
  options: FetchArbitrationRequestsOptions = {},
): Promise<ArbitrationRequestsSnapshot> {
  const { signal, lookbackBlocks } = options
  assertLookback(lookbackBlocks)
  throwIfAborted(signal)
  const head = await getBlockHeader(rpc, "latest")
  throwIfAborted(signal)
  if (head.number < config.deploymentBlock) {
    throw new Error(`The RPC head ${head.number} is before the oracle deployment block ${config.deploymentBlock}`)
  }
  const { previous, generation } = await resolveBase(rpc, head, options.previous)
  throwIfAborted(signal)

  const searchFromBlock = discoveryStart(config, head.number, lookbackBlocks)
  const plan = planScan(config, head.number, searchFromBlock, previous)
  const logsRpc = options.logsRpc ?? rpc
  const [older, newer] = await Promise.all([
    readDisputes(logsRpc, config, plan.history),
    readDisputes(logsRpc, config, plan.forward),
  ])
  throwIfAborted(signal)
  const reads = planStateReads(previous, head, searchFromBlock, [...older, ...newer])
  const requests = await readOpenRequests(rpc, config.oracleAddress, reads, head.number, signal)
  throwIfAborted(signal)

  const confirmed = await getBlockHeader(rpc, head.number)
  if (confirmed.hash !== head.hash) {
    throw new Error(`Block ${head.number} changed while its requests were read; try again`)
  }
  throwIfAborted(signal)
  return {
    requests,
    searchFromBlock,
    historyToBlock: plan.historyToBlock,
    liveThroughBlock: plan.liveThroughBlock,
    observedBlock: head.number,
    observedBlockHash: head.hash,
    generation,
  }
}
