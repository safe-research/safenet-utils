import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { type Address, encodeFunctionData, type Hex } from "viem"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"

// The arbitrator's options for a `FROZEN` request: side with the approving or the denying sentinels
// (`resolveDispute`), or decline to rule (`markOutOfScope`).
export type Ruling = "approve" | "deny" | "outOfScope"

export const RULINGS: readonly Ruling[] = ["approve", "deny", "outOfScope"]

export const RULING_LABELS: Record<Ruling, string> = {
  approve: "Approve",
  deny: "Deny",
  outOfScope: "Decline",
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

// Proposes the ruling as a Safe transaction. Safe{Wallet} takes over from here: the owners confirm (their "vote") and
// execute it through its usual flow, so the returned `safeTxHash` only means the transaction was queued.
export async function submitRuling(
  sdk: SafeAppsSDK,
  oracleAddress: Address,
  requestId: Hex,
  ruling: Ruling,
  context: string,
): Promise<{ safeTxHash: string }> {
  const { safeTxHash } = await sdk.txs.send({
    txs: [{ to: oracleAddress, value: "0", data: encodeRuling(requestId, ruling, context) }],
  })
  return { safeTxHash }
}
