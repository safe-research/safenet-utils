// @vitest-environment node
import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { createPublicClient, type Hex, http } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ethCall, getBlockHeader, getLogs, type LogFilter, type ReadRpc, rpcNumber } from "@/lib/rpc"

const ORACLE = "0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0"
const OTHER = "0x4444444444444444444444444444444444444444"

const hash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`

const FILTER: LogFilter = { address: ORACLE, fromBlock: 10, toBlock: 11, topics: [] }

// A log as a JSON-RPC node sends it: hex quantities and every identity field present.
const wireLog = (overrides: Record<string, unknown> = {}) => ({
  address: ORACLE,
  topics: [hash(99)],
  data: "0x",
  blockHash: hash(10),
  blockNumber: "0xa",
  transactionHash: hash(1),
  transactionIndex: "0x0",
  logIndex: "0x1",
  removed: false,
  ...overrides,
})

type RpcCall = { method: string; params: unknown[] }

type Connection = { rpc: ReadRpc; calls: RpcCall[] }

// A chain's answer to one RPC call. Throwing is a provider failure.
type Handler = (call: RpcCall) => unknown

// Both transports speak to the same fake chain, so each behavior is proven for the Safe Wallet SDK and for a standard
// viem client alike. Only the HTTP boundary of the viem client is faked.
function viaSdk(handle: Handler): Connection {
  const calls: RpcCall[] = []
  const endpoint = (method: string) => async (params: unknown[]) => {
    calls.push({ method, params })
    return handle({ method, params })
  }
  const eth = {
    call: endpoint("eth_call"),
    getPastLogs: endpoint("eth_getLogs"),
    getBlockByNumber: endpoint("eth_getBlockByNumber"),
  }
  return { rpc: { eth } as unknown as SafeAppsSDK, calls }
}

function viaViemClient(handle: Handler): Connection {
  const calls: RpcCall[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { id, method, params } = JSON.parse(String(init?.body))
      calls.push({ method, params })
      try {
        return Response.json({ jsonrpc: "2.0", id, result: handle({ method, params }) })
      } catch (error) {
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(error) } })
      }
    }),
  )
  return { rpc: createPublicClient({ transport: http("https://rpc.test", { retryCount: 0 }) }), calls }
}

afterEach(() => vi.unstubAllGlobals())

describe("rpcNumber", () => {
  it("accepts SDK numbers and RPC hex quantities without losing precision", () => {
    expect(rpcNumber(42)).toBe(42)
    expect(rpcNumber("0x2a")).toBe(42)
    expect(rpcNumber("0x0")).toBe(0)
    expect(rpcNumber("0x1fffffffffffff")).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([undefined, null, "42", "0x", -1, 1.5, Infinity, "0x20000000000000"])(
    "rejects an invalid or imprecise quantity: %s",
    (value) => expect(() => rpcNumber(value)).toThrow("Invalid RPC block number or log index"),
  )
})

describe.each([
  ["Safe Wallet SDK", viaSdk],
  ["viem client", viaViemClient],
])("reads through the %s", (_transport, connect) => {
  describe("ethCall", () => {
    it("addresses the caller and block as hex quantities, defaulting to the latest block", async () => {
      const { rpc, calls } = connect(() => "0x1234")

      await expect(ethCall(rpc, ORACLE, "0xdeadbeef", { from: OTHER, block: 42 })).resolves.toBe("0x1234")
      await ethCall(rpc, ORACLE, "0xdeadbeef")

      expect(calls).toEqual([
        { method: "eth_call", params: [{ to: ORACLE, data: "0xdeadbeef", value: "0x0", from: OTHER }, "0x2a"] },
        { method: "eth_call", params: [{ to: ORACLE, data: "0xdeadbeef", value: "0x0" }, "latest"] },
      ])
    })

    it("accepts an empty successful result", async () => {
      const { rpc } = connect(() => "0x")

      await expect(ethCall(rpc, ORACLE, "0xdeadbeef")).resolves.toBe("0x")
    })

    it.each([null, "nope", 7])("rejects a result that is not hex: %s", async (result) => {
      const { rpc } = connect(() => result)

      await expect(ethCall(rpc, ORACLE, "0xdeadbeef")).rejects.toThrow("invalid eth_call result")
    })

    it("rejects an unusable block without asking the RPC", async () => {
      const { rpc, calls } = connect(() => "0x")

      await expect(ethCall(rpc, ORACLE, "0xdeadbeef", { block: -1 })).rejects.toThrow("Invalid RPC block number")
      expect(calls).toEqual([])
    })

    it("reports a provider failure", async () => {
      const { rpc } = connect(() => {
        throw new Error("rpc unavailable")
      })

      await expect(ethCall(rpc, ORACLE, "0xdeadbeef")).rejects.toThrow()
    })
  })

  describe("getBlockHeader", () => {
    it.each(["0x64", 100])("normalizes the latest block, whose number is sent as %j", async (number) => {
      const { rpc } = connect(() => ({ number, hash: hash(0xabc).toUpperCase().replace("0X", "0x") }))

      await expect(getBlockHeader(rpc, "latest")).resolves.toEqual({ number: 100, hash: hash(0xabc) })
    })

    it("returns the block at a given height", async () => {
      const { rpc } = connect(() => ({ number: "0x2a", hash: hash(0xabc) }))

      await expect(getBlockHeader(rpc, 42)).resolves.toEqual({ number: 42, hash: hash(0xabc) })
    })

    it.each([
      ["no block", null, "no valid header"],
      ["a pending block", { number: null, hash: null }, "no valid header"],
      ["a malformed hash", { number: "0x2a", hash: "0x1234" }, "no valid header"],
      ["a decimal-string number", { number: "42", hash: hash(1) }, "Invalid RPC block number"],
      ["a different block than requested", { number: "0x2b", hash: hash(1) }, "asked for block 42"],
    ])("rejects %s", async (_name, header, message) => {
      const { rpc } = connect(() => header)

      await expect(getBlockHeader(rpc, 42)).rejects.toThrow(message)
    })

    it("rejects an unusable height without asking the RPC", async () => {
      const { rpc, calls } = connect(() => ({ number: "0x1", hash: hash(1) }))

      await expect(getBlockHeader(rpc, 1.5)).rejects.toThrow("Invalid RPC block number")
      expect(calls).toEqual([])
    })
  })

  describe("getLogs", () => {
    it("asks for the inclusive range as hex quantities and keeps OR-ed topics", async () => {
      const topics = [[hash(5), hash(6)], null, hash(7)]
      const { rpc, calls } = connect(() => [])

      await expect(getLogs(rpc, { ...FILTER, topics })).resolves.toEqual([])

      expect(calls).toEqual([
        { method: "eth_getLogs", params: [{ address: ORACLE, topics, fromBlock: "0xa", toBlock: "0xb" }] },
      ])
    })

    it("returns unique logs in chain order with numeric positions", async () => {
      const earlier = wireLog()
      const later = wireLog({
        blockNumber: 11,
        blockHash: hash(11),
        transactionHash: hash(2),
        transactionIndex: 3,
        logIndex: 0,
      })
      const sameTransaction = wireLog({
        blockNumber: "0xb",
        blockHash: hash(11),
        transactionHash: hash(2),
        logIndex: "0x2",
      })
      const { rpc } = connect(() => [sameTransaction, later, earlier, earlier])

      const logs = await getLogs(rpc, FILTER)

      expect(logs).toEqual([
        {
          address: ORACLE,
          topics: [hash(99)],
          data: "0x",
          blockHash: hash(10),
          blockNumber: 10,
          transactionHash: hash(1),
          transactionIndex: 0,
          logIndex: 1,
        },
        expect.objectContaining({ blockNumber: 11, transactionHash: hash(2), transactionIndex: 3, logIndex: 0 }),
        expect.objectContaining({ blockNumber: 11, transactionHash: hash(2), transactionIndex: 0, logIndex: 2 }),
      ])
    })

    it.each([
      ["a pending log without a transaction hash", { transactionHash: null }, "invalid transaction hash"],
      ["a log without a block number", { blockNumber: null }, "Invalid RPC block number"],
      ["a log without a log index", { logIndex: null }, "Invalid RPC block number or log index"],
      ["a log without a transaction index", { transactionIndex: null }, "Invalid RPC block number or log index"],
      ["a log without a block hash", { blockHash: null }, "malformed"],
      ["a log with a truncated topic", { topics: ["0x12"] }, "malformed"],
      ["a log with non-hex data", { data: "nope" }, "malformed"],
      ["a log of another contract", { address: OTHER }, "outside the requested filter"],
      ["a log before the range", { blockNumber: "0x9" }, "outside the requested filter"],
      ["a log after the range", { blockNumber: 12 }, "outside the requested filter"],
    ])("rejects %s instead of dropping it", async (_name, change, message) => {
      const { rpc } = connect(() => [wireLog(change)])

      await expect(getLogs(rpc, FILTER)).rejects.toThrow(message)
    })

    it("rejects missing log identity instead of collapsing unrelated events", async () => {
      const { rpc } = connect(() => [{ blockNumber: 10, logIndex: 0 }])

      await expect(getLogs(rpc, FILTER)).rejects.toThrow("invalid transaction hash")
    })

    it.each([null, {}])("rejects a response that is not a log list: %j", async (result) => {
      const { rpc } = connect(() => result)

      await expect(getLogs(rpc, FILTER)).rejects.toThrow("invalid log list")
    })

    it("reports a provider failure instead of an empty result", async () => {
      const { rpc } = connect(() => {
        throw new Error("rpc unavailable")
      })

      await expect(getLogs(rpc, FILTER)).rejects.toThrow()
    })

    it("rejects an inverted range without asking the RPC", async () => {
      const { rpc, calls } = connect(() => [])

      await expect(getLogs(rpc, { ...FILTER, fromBlock: 12 })).rejects.toThrow("Invalid RPC log range")
      expect(calls).toEqual([])
    })
  })
})

describe("reads through a viem client", () => {
  it("asks for a block by hex quantity without its transactions", async () => {
    const { rpc, calls } = viaViemClient(() => ({ number: "0x2a", hash: hash(1) }))

    await getBlockHeader(rpc, 42)
    await getBlockHeader(rpc, "latest")

    expect(calls.map(({ params }) => params)).toEqual([
      ["0x2a", false],
      ["latest", false],
    ])
  })
})
