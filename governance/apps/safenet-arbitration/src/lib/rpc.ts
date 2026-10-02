import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { Log } from "@safe-global/safe-apps-sdk"
import { type Address, type Hex, isHex, numberToHex, type PublicClient } from "viem"

/** Where reads go: the Safe Wallet's SDK bridge, or a standard JSON-RPC client the operator chose. */
export type ReadRpc = SafeAppsSDK | Pick<PublicClient, "request">

/** A read transport plus the identity its cached results are scoped to (`"wallet"` or the normalized RPC URL). */
export type ReadSource = { rpc: ReadRpc; key: string }

export type RpcBlockHeader = { number: number; hash: Hex }

export type LogFilter = {
  address: Address
  fromBlock: number
  toBlock: number
  topics: (Hex | Hex[] | null)[]
}

type HexLogFilter = Omit<LogFilter, "fromBlock" | "toBlock"> & {
  fromBlock: Hex
  toBlock: Hex
}

// Everything below treats wire data as untrusted: the SDK types claim numbers, JSON-RPC sends hex quantities, and a
// pending log or missing block carries nulls.
type WireLog = {
  address?: unknown
  data?: unknown
  topics?: unknown
  blockHash?: unknown
  blockNumber?: unknown
  transactionHash?: unknown
  transactionIndex?: unknown
  logIndex?: unknown
}

type WireHeader = { number?: unknown; hash?: unknown }

const isSdk = (rpc: ReadRpc): rpc is SafeAppsSDK => "eth" in rpc

const isHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value)

const isHashList = (value: unknown): value is Hex[] => Array.isArray(value) && value.every(isHash)

/** Converts SDK numbers or RPC quantities without losing block/index precision. */
export function rpcNumber(value: unknown): number {
  const number = typeof value === "string" && /^0x[\da-f]+$/i.test(value) ? Number(value) : value
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid RPC block number or log index")
  }
  return number
}

/** Reads or simulates an oracle call at the requested block and caller. */
export async function ethCall(
  rpc: ReadRpc,
  to: Address,
  data: Hex,
  options: { from?: Address; block?: number | "latest" } = {},
): Promise<Hex> {
  const block = options.block ?? "latest"
  const blockParam = typeof block === "number" ? numberToHex(rpcNumber(block)) : block
  const transaction = { to, data, value: "0x0" as const, ...(options.from ? { from: options.from } : {}) }
  const result: unknown = isSdk(rpc)
    ? await rpc.eth.call([transaction, blockParam])
    : await rpc.request({ method: "eth_call", params: [transaction, blockParam] })
  if (!isHex(result)) {
    throw new Error("The RPC returned an invalid eth_call result")
  }
  return result
}

function normalizeHeader(header: unknown, block: number | "latest"): RpcBlockHeader {
  const { number, hash } = (typeof header === "object" && header !== null ? header : {}) as WireHeader
  if (!isHash(hash)) {
    throw new Error(`The RPC returned no valid header for block ${block}`)
  }
  const normalized = rpcNumber(number)
  if (block !== "latest" && normalized !== block) {
    throw new Error(`The RPC returned block ${normalized} when asked for block ${block}`)
  }
  return { number: normalized, hash: hash.toLowerCase() as Hex }
}

/** Reads one block's number and hash, normalized and validated, from the latest block or a given height. */
export async function getBlockHeader(rpc: ReadRpc, block: number | "latest"): Promise<RpcBlockHeader> {
  const height = block === "latest" ? block : rpcNumber(block)
  const header: unknown = isSdk(rpc)
    ? await rpc.eth.getBlockByNumber([height])
    : await rpc.request({
        method: "eth_getBlockByNumber",
        params: [typeof height === "number" ? numberToHex(height) : height, false],
      })
  return normalizeHeader(header, height)
}

function requestLogs(rpc: ReadRpc, filter: HexLogFilter): Promise<unknown> {
  if (!isSdk(rpc)) {
    return rpc.request({ method: "eth_getLogs", params: [filter] })
  }
  // SDK 9.1 forwards filters unchanged, but its types omit standard hex block quantities.
  const request = rpc.eth.getPastLogs as unknown as (params: [HexLogFilter]) => Promise<unknown>
  return request([filter])
}

function isLogOf(address: unknown, blockNumber: number, filter: LogFilter): address is string {
  return (
    typeof address === "string" &&
    address.toLowerCase() === filter.address.toLowerCase() &&
    blockNumber >= filter.fromBlock &&
    blockNumber <= filter.toBlock
  )
}

function normalizeLog(entry: unknown, filter: LogFilter): Log {
  const wire = (typeof entry === "object" && entry !== null ? entry : {}) as WireLog
  const { transactionHash, address } = wire
  if (!isHash(transactionHash)) {
    throw new Error("RPC log has an invalid transaction hash")
  }
  const blockNumber = rpcNumber(wire.blockNumber)
  if (!isLogOf(address, blockNumber, filter)) {
    throw new Error(`RPC log outside the requested filter (${transactionHash})`)
  }
  const { blockHash, topics, data } = wire
  if (!isHash(blockHash) || !isHashList(topics) || !isHex(data)) {
    throw new Error(`RPC log has a malformed block hash, topics or data (${transactionHash})`)
  }
  const logIndex = rpcNumber(wire.logIndex)
  const transactionIndex = rpcNumber(wire.transactionIndex)
  return { address, data, topics, blockHash, blockNumber, transactionHash, transactionIndex, logIndex }
}

/** Loads an inclusive range as unique, chronological logs with numeric positions. */
export async function getLogs(rpc: ReadRpc, filter: LogFilter): Promise<Log[]> {
  const fromBlock = rpcNumber(filter.fromBlock)
  const toBlock = rpcNumber(filter.toBlock)
  if (fromBlock > toBlock) {
    throw new Error(`Invalid RPC log range: ${fromBlock}–${toBlock}`)
  }
  const hexFilter = {
    address: filter.address,
    topics: filter.topics,
    fromBlock: numberToHex(fromBlock),
    toBlock: numberToHex(toBlock),
  }
  const wireLogs = await requestLogs(rpc, hexFilter)
  if (!Array.isArray(wireLogs)) {
    throw new Error("The RPC returned an invalid log list")
  }
  const unique = new Map<string, Log>()
  const normalizedFilter = { ...filter, fromBlock, toBlock }
  for (const wire of wireLogs) {
    const log = normalizeLog(wire, normalizedFilter)
    unique.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log)
  }
  return [...unique.values()].sort(
    (left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
  )
}
