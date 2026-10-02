import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { BaseError, createClient, http, HttpRequestError, type PublicClient, RpcRequestError } from "viem"
import type { OracleConfig } from "@/config/oracle"
import { type ReadSource, rpcNumber } from "@/lib/rpc"

export const DEFAULT_LOOKBACK_BLOCKS = 10_000

export const WALLET_SOURCE_KEY = "wallet"

export type ReadSettings = {
  // How many of the newest blocks to search for disputes; `null` searches the full deployment history.
  lookbackBlocks: number | null
  // The normalized custom RPC URL, or "" to read through the Safe Wallet.
  rpcUrl: string
}

type PublicRequest = PublicClient["request"]

type RpcRequest = { method: string; params?: unknown }

// `URL.hostname` keeps the brackets of an IPv6 literal.
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

// A custom RPC only supplies historical event logs (plus the chain check). Contract state, block heads and simulations
// stay with the Safe Wallet, so an unverified provider is never an authority on a request's current state, and
// sending or signing is refused outright.
const CUSTOM_RPC_METHODS = ["eth_chainId", "eth_getLogs"]

function parseLookback(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  const blocks = /^\d+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isSafeInteger(blocks) || blocks < 1) {
    throw new Error("Lookback must be a whole number of blocks above 0, or blank for the full deployment history.")
  }
  return blocks
}

// Rejections never repeat the input: it may be a URL with an API key in it.
function parseUrl(text: string): URL {
  try {
    return new URL(text)
  } catch {
    throw new Error("Enter the full RPC URL, including https://.")
  }
}

function normalizeRpcUrl(input: string): string {
  const text = input.trim()
  if (!text) return ""
  const url = parseUrl(text)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname))) {
    throw new Error("The RPC URL must use https (plain http is only allowed for localhost).")
  }
  if (url.username || url.password) {
    throw new Error("The RPC URL must not embed a username or password.")
  }
  if (url.href.includes("#")) {
    throw new Error("The RPC URL must not contain a fragment (#).")
  }
  return url.href
}

/** Validates the settings form: a blank lookback means the full history, a blank URL means the Safe Wallet. */
export function parseReadSettings(lookback: string, rpcUrl: string): ReadSettings {
  return { lookbackBlocks: parseLookback(lookback), rpcUrl: normalizeRpcUrl(rpcUrl) }
}

function describeFailure(error: unknown): string {
  const failure =
    error instanceof BaseError
      ? error.walk((cause) => cause instanceof HttpRequestError || cause instanceof RpcRequestError)
      : error
  if (failure instanceof HttpRequestError && failure.status) {
    return `HTTP ${failure.status}. Check the RPC service's permissions and limits.`
  }
  if (failure instanceof RpcRequestError && Number.isInteger(failure.code)) {
    return `RPC error ${failure.code}. Check the provider's limits and history support.`
  }
  return "Check the URL and whether the RPC allows browser requests from this app."
}

// A log-only viem client over HTTP without retries. Its failures are rewritten, because viem's own messages and
// causes carry the URL and with it the API key, and errors from reads are shown to the operator.
function createCustomRpc(rpcUrl: string): Pick<PublicClient, "request"> {
  const client = createClient({ transport: http(rpcUrl, { retryCount: 0 }) })
  // viem types `request` per method, but this only gates and forwards, so its public type is asserted once.
  const forward = client.request as unknown as (request: RpcRequest) => Promise<unknown>
  const request = async (rpcRequest: RpcRequest) => {
    if (!CUSTOM_RPC_METHODS.includes(rpcRequest.method)) {
      throw new Error(`The custom RPC only supplies event logs; ${rpcRequest.method} is not allowed.`)
    }
    try {
      return await forward(rpcRequest)
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- Provider causes can contain RPC credentials.
      throw new Error(`Custom RPC ${rpcRequest.method} failed: ${describeFailure(error)}`)
    }
  }
  return { request: request as unknown as PublicRequest }
}

async function readChainId(rpc: Pick<PublicClient, "request">): Promise<number> {
  let reported: unknown
  try {
    reported = await rpc.request({ method: "eth_chainId" })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The request failed."
    throw new Error(
      `Could not connect to the custom RPC. Check the URL and that it allows requests from this app. (${reason})`,
      { cause: error },
    )
  }
  try {
    return rpcNumber(reported)
  } catch {
    throw new Error("The custom RPC returned an invalid chain ID.")
  }
}

/**
 * Picks where reads go: the Safe Wallet's SDK for a blank URL, otherwise a custom RPC that is proven to serve the
 * configured chain before anything is read from it.
 */
export async function createReadSource(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  settings: ReadSettings,
): Promise<ReadSource> {
  const rpcUrl = normalizeRpcUrl(settings.rpcUrl)
  if (!rpcUrl) return { rpc: sdk, key: WALLET_SOURCE_KEY }
  const rpc = createCustomRpc(rpcUrl)
  const chainId = await readChainId(rpc)
  if (chainId !== config.chainId) {
    throw new Error(
      `The custom RPC serves chain ${chainId}, but this app reads chain ${config.chainId}. ` +
        `Use an RPC URL for chain ${config.chainId}.`,
    )
  }
  return { rpc, key: rpcUrl }
}
