// @vitest-environment node
import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { PublicClient } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseConfig } from "@/config/oracle"
import { createReadSource, parseReadSettings } from "@/lib/readSettings"
import { getLogs } from "@/lib/rpc"

const CONFIG = parseConfig({})
const SDK = { eth: {} } as unknown as SafeAppsSDK

const API_KEY = "SECRETKEY0123456789"
const QUERY_SECRET = "QUERYSECRET987"
const KEYED_URL = `https://rpc.example.org/v2/${API_KEY}?apikey=${QUERY_SECRET}`

type RpcCall = { method: string; params: unknown[] }

// Fakes the network under the viem client: the node answers every JSON-RPC call with `handle`'s result, and a throw
// is a JSON-RPC error.
function serveRpc(handle: (call: RpcCall) => unknown) {
  const calls: RpcCall[] = []
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init?.body))
    calls.push({ method, params })
    try {
      return Response.json({ jsonrpc: "2.0", id, result: handle({ method, params }) })
    } catch (error) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(error) } })
    }
  })
  vi.stubGlobal("fetch", fetchMock)
  return { calls, fetchMock }
}

function serveFetch(respond: () => Promise<Response>) {
  const fetchMock = vi.fn(respond)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function failure(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error("Expected the call to fail")
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error("Expected the call to be rejected")
}

// What an operator must never see in an error, however the failure came about.
function expectRedacted(error: Error) {
  const text = `${error.message} ${String(error.cause)}`
  expect(text).not.toContain(API_KEY)
  expect(text).not.toContain(QUERY_SECRET)
  expect(text).not.toContain("rpc.example.org")
}

type RawRequest = (call: { method: string; params: unknown[] }) => Promise<unknown>

afterEach(() => vi.unstubAllGlobals())

describe("parseReadSettings", () => {
  it("reads blank fields as the full history through the Safe Wallet", () => {
    expect(parseReadSettings("", "")).toEqual({ lookbackBlocks: null, rpcUrl: "" })
    expect(parseReadSettings("  ", "\t")).toEqual({ lookbackBlocks: null, rpcUrl: "" })
  })

  it.each([
    ["25", 25],
    [" 10000 ", 10_000],
    ["007", 7],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("accepts the positive whole lookback %j", (input, blocks) => {
    expect(parseReadSettings(input, "").lookbackBlocks).toBe(blocks)
  })

  it.each(["0", "-5", "1.5", "1e3", "abc", "0x10", "10,000", "+5", "9007199254740992"])(
    "rejects the lookback %j",
    (input) => expect(() => parseReadSettings(input, "")).toThrow("Lookback"),
  )

  it.each([
    ["  https://rpc.example.org  ", "https://rpc.example.org/"],
    ["HTTPS://RPC.Example.org/v2/KeyAbc?x=1", "https://rpc.example.org/v2/KeyAbc?x=1"],
    ["http://localhost:8545", "http://localhost:8545/"],
    ["http://127.0.0.1:8545/", "http://127.0.0.1:8545/"],
    ["http://[::1]:8545", "http://[::1]:8545/"],
  ])("accepts and normalizes the URL %j", (input, normalized) => {
    expect(parseReadSettings("", input).rpcUrl).toBe(normalized)
  })

  it.each([
    "rpc.example.org",
    "http://rpc.example.org",
    "http://localhost.example.org",
    "http://10.0.0.5:8545",
    "ws://localhost:8546",
    "ftp://rpc.example.org",
    "javascript:alert(1)",
    "https://user:pass@rpc.example.org",
    "https://user@rpc.example.org",
    "https://rpc.example.org/#fragment",
    "https://rpc.example.org/#",
  ])("rejects the URL %j", (input) => {
    expect(() => parseReadSettings("", input)).toThrow()
  })

  it.each([
    `http://rpc.example.org/v2/${API_KEY}`,
    `https://user:${API_KEY}@rpc.example.org`,
    `${KEYED_URL}#top`,
    API_KEY,
  ])("never repeats a rejected URL in its message: %#", (input) => {
    const { message } = failure(() => parseReadSettings("", input))

    expect(message).not.toContain(API_KEY)
    expect(message).not.toContain(QUERY_SECRET)
    expect(message).not.toContain("rpc.example.org")
  })
})

describe("createReadSource", () => {
  it("reads through the Safe Wallet itself for a blank URL, without touching the network", async () => {
    const { fetchMock } = serveRpc(() => "0x64")

    const source = await createReadSource(SDK, CONFIG, parseReadSettings("", ""))

    expect(source.rpc).toBe(SDK)
    expect(source.key).toBe("wallet")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reads logs through a custom RPC once it has proven to serve the configured chain", async () => {
    const { calls, fetchMock } = serveRpc(({ method }) => (method === "eth_chainId" ? "0x64" : []))

    const source = await createReadSource(SDK, CONFIG, parseReadSettings("", " https://rpc.example.org/v2/key "))
    const logs = await getLogs(source.rpc, { address: CONFIG.oracleAddress, fromBlock: 5, toBlock: 6, topics: [] })

    expect(source.key).toBe("https://rpc.example.org/v2/key")
    expect(source.rpc).not.toBe(SDK)
    expect(logs).toEqual([])
    expect(calls.map(({ method }) => method)).toEqual(["eth_chainId", "eth_getLogs"])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([source.key, source.key])
  })

  it("keys equivalent spellings of one URL identically", async () => {
    serveRpc(() => "0x64")

    const first = await createReadSource(SDK, CONFIG, parseReadSettings("", "HTTPS://RPC.Example.org"))
    const second = await createReadSource(SDK, CONFIG, parseReadSettings("", "https://rpc.example.org/"))

    expect(first.key).toBe(second.key)
  })

  it("checks settings that did not come from the parser", async () => {
    const { fetchMock } = serveRpc(() => "0x64")
    const unparsed = { lookbackBlocks: null, rpcUrl: "http://rpc.example.org" }

    await expect(createReadSource(SDK, CONFIG, unparsed)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an RPC that serves another chain", async () => {
    serveRpc(() => "0x1")

    const error = await rejection(createReadSource(SDK, CONFIG, parseReadSettings("", KEYED_URL)))

    expect(error.message).toContain("serves chain 1")
    expect(error.message).toContain(`reads chain ${CONFIG.chainId}`)
  })

  it.each(["nope", null, "100"])("rejects a chain ID that is not a hex quantity: %j", async (chainId) => {
    serveRpc(() => chainId)

    const error = await rejection(createReadSource(SDK, CONFIG, parseReadSettings("", KEYED_URL)))

    expect(error.message).toContain("invalid chain ID")
  })

  it("does not retry a failed connection", async () => {
    const fetchMock = serveFetch(() => Promise.reject(new TypeError("Failed to fetch")))

    const error = await rejection(createReadSource(SDK, CONFIG, parseReadSettings("", "https://rpc.example.org")))

    expect(error.message).toContain("Could not connect to the custom RPC")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports the HTTP status of a rejecting RPC", async () => {
    serveFetch(async () => new Response("Too many requests", { status: 429 }))

    const error = await rejection(createReadSource(SDK, CONFIG, parseReadSettings("", "https://rpc.example.org")))

    expect(error.message).toContain("HTTP 429")
  })

  describe("keeps the URL and its API key out of every error", () => {
    const scenarios: [string, () => unknown][] = [
      [
        "a network failure that names the URL",
        () => serveFetch(() => Promise.reject(new Error(`failed: ${KEYED_URL}`))),
      ],
      [
        "an HTTP rejection that echoes the key",
        () =>
          serveFetch(async () =>
            Response.json({ error: `invalid key ${API_KEY} (${QUERY_SECRET}) for rpc.example.org` }, { status: 401 }),
          ),
      ],
      [
        "a JSON-RPC error that echoes the key",
        () =>
          serveRpc(() => {
            throw new Error(`unknown key ${API_KEY} ${QUERY_SECRET}`)
          }),
      ],
    ]

    it.each(scenarios)("after %s", async (_name, setUp) => {
      setUp()

      const error = await rejection(createReadSource(SDK, CONFIG, parseReadSettings("", KEYED_URL)))

      expect(error.message).toContain("Could not connect to the custom RPC")
      expectRedacted(error)
    })

    it("when a later log read fails", async () => {
      let failing = false
      serveRpc(({ method }) => {
        if (failing) throw new Error(`rate limit for ${KEYED_URL}`)
        return method === "eth_chainId" ? "0x64" : []
      })
      const source = await createReadSource(SDK, CONFIG, parseReadSettings("", KEYED_URL))
      failing = true

      const filter = { address: CONFIG.oracleAddress, fromBlock: 1, toBlock: 2, topics: [] }
      const error = await rejection(getLogs(source.rpc, filter))

      expect(error.message).toContain("eth_getLogs")
      expectRedacted(error)
    })
  })

  it.each(["eth_call", "eth_getBlockByNumber", "eth_sendRawTransaction", "eth_sendTransaction", "personal_sign"])(
    "never sends %s through the custom RPC",
    async (method) => {
      const { calls } = serveRpc(() => "0x64")
      const source = await createReadSource(SDK, CONFIG, parseReadSettings("", "https://rpc.example.org"))
      const request = (source.rpc as Pick<PublicClient, "request">).request as unknown as RawRequest

      await expect(request({ method, params: [] })).rejects.toThrow("only supplies event logs")

      expect(calls.map((call) => call.method)).toEqual(["eth_chainId"])
    },
  )
})
