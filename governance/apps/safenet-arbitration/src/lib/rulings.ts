import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { type Address, decodeFunctionResult, encodeFunctionData, getAddress, type Hex } from "viem"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import type { OracleConfig } from "@/config/oracle"
import { getRequest } from "@/lib/arbitrationRequests"
import { ethCall } from "@/lib/rpc"

// The arbitrator's options for a `FROZEN` request: side with the approving or the denying sentinels
// (`resolveDispute`), or decline to rule (`markOutOfScope`).
export type Ruling = "approve" | "deny" | "outOfScope"

export const RULINGS: readonly Ruling[] = ["approve", "deny", "outOfScope"]

export const RULING_LABELS: Record<Ruling, string> = {
  approve: "Rule secure",
  deny: "Rule insecure",
  outOfScope: "Out of scope",
}

export type SubmitRulingInput = {
  requestId: Hex
  ruling: Ruling
  context: string
  expectedSafeAddress: string
  evidenceReady: boolean
}

type SafeIdentity = { safeAddress: Address; chainId: number }

export type SubmittedRuling = SafeIdentity & { safeTxHash: string }

async function attempt<T>(doing: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    throw new Error(`${doing}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

/** Reads the Safe authorized to resolve disputes for this oracle. */
export async function getArbitrator(sdk: SafeAppsSDK, oracleAddress: Address): Promise<Address> {
  const result = await ethCall(
    sdk,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "ARBITRATOR" }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "ARBITRATOR", data: result })
}

// Calldata for the oracle call recording `ruling` on `requestId`, with `context` as the on-chain rationale.
export function encodeRuling(requestId: Hex, ruling: Ruling, context: string): Hex {
  if (ruling === "outOfScope") {
    return encodeFunctionData({ abi: sentinelOracleAbi, functionName: "markOutOfScope", args: [requestId, context] })
  }
  return encodeFunctionData({
    abi: sentinelOracleAbi,
    functionName: "resolveDispute",
    args: [requestId, ruling === "approve", context],
  })
}

function requireRulingAllowed({ ruling, evidenceReady }: SubmitRulingInput, context: string) {
  if (context === "") {
    throw new Error("A rationale is required: it is recorded on-chain with the ruling")
  }
  if (ruling !== "outOfScope" && !evidenceReady) {
    throw new Error("Secure and insecure rulings need verified transaction evidence and complete sentinel evidence")
  }
}

async function readConnectedSafe(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  expectedSafeAddress: string,
): Promise<SafeIdentity> {
  const safe = await attempt("Could not read the connected Safe", () => sdk.safe.getInfo())
  if (safe.chainId !== config.chainId) {
    throw new Error(`The connected Safe is on chain ${safe.chainId}, but arbitration runs on chain ${config.chainId}`)
  }
  if (safe.safeAddress.toLowerCase() !== expectedSafeAddress.toLowerCase()) {
    throw new Error(
      `The connected Safe ${safe.safeAddress} is not the Safe ${expectedSafeAddress} this ruling was prepared for`,
    )
  }
  if (safe.isReadOnly !== false) {
    throw new Error("The connected Safe is read-only here, so it cannot propose a ruling")
  }
  return { safeAddress: getAddress(safe.safeAddress), chainId: safe.chainId }
}

async function requireArbitrator(sdk: SafeAppsSDK, config: OracleConfig, { safeAddress }: SafeIdentity) {
  const arbitrator = await attempt("Could not read the oracle's arbitrator", () =>
    getArbitrator(sdk, config.oracleAddress),
  )
  if (arbitrator.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(`The connected Safe ${safeAddress} is not the oracle's arbitrator ${arbitrator}`)
  }
}

async function requireFrozen(sdk: SafeAppsSDK, config: OracleConfig, requestId: Hex) {
  const { progress } = await attempt("Could not read the request's state", () =>
    getRequest(sdk, config.oracleAddress, requestId),
  )
  if (progress.state !== RequestState.FROZEN) {
    throw new Error(`Request ${requestId} is not awaiting arbitration (on-chain state ${progress.state})`)
  }
}

// A successful call can return "0x": ruling methods have no return value.
async function simulateRuling(sdk: SafeAppsSDK, config: OracleConfig, { safeAddress }: SafeIdentity, data: Hex) {
  await attempt("Could not simulate the ruling from the Arbitrator Safe", () =>
    ethCall(sdk, config.oracleAddress, data, { from: safeAddress, block: "latest" }),
  )
}

/** Checks authorization and state, simulates, then queues one ruling. The hash proves proposal, not execution. */
export async function submitRuling(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  input: SubmitRulingInput,
): Promise<SubmittedRuling> {
  const { requestId, ruling, expectedSafeAddress } = input
  const context = input.context.trim()
  requireRulingAllowed(input, context)
  const safe = await readConnectedSafe(sdk, config, expectedSafeAddress)
  await requireArbitrator(sdk, config, safe)
  await requireFrozen(sdk, config, requestId)

  const data = encodeRuling(requestId, ruling, context)
  await simulateRuling(sdk, config, safe, data)
  const submitting = await readConnectedSafe(sdk, config, expectedSafeAddress)
  await requireFrozen(sdk, config, requestId)

  const { safeTxHash } = await sdk.txs.send({ txs: [{ to: config.oracleAddress, value: "0", data }] })
  return { safeTxHash, ...submitting }
}
