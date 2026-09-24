import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { decodeFunctionData } from "viem"
import { describe, expect, it, vi } from "vitest"
import { CONFIG, requestId } from "@/__tests__/mock-sentinel-oracle"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { encodeRuling, submitRuling } from "@/lib/rulings"

// Selectors are from the compiled contract at the ABI's pinned commit, guarding against a mistyped fragment.
// Multi-line, non-ASCII and longer than one ABI word, so the dynamic `string` encoding is actually exercised.
const CONTEXT = "Sentinels 1–3 missed the delegatecall.\nSee https://forum.example/t/42 — ruling: approve ✅".repeat(2)

describe("encodeRuling", () => {
  it("encodes approve as resolveDispute in favour of the approving sentinels", () => {
    const data = encodeRuling(requestId(0xabc), "approve", CONTEXT)

    expect(data.slice(0, 10)).toBe("0x795e0a79")
    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "resolveDispute",
      args: [requestId(0xabc), true, CONTEXT],
    })
  })

  it("encodes deny as resolveDispute in favour of the denying sentinels", () => {
    const data = encodeRuling(requestId(0xabc), "deny", CONTEXT)

    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "resolveDispute",
      args: [requestId(0xabc), false, CONTEXT],
    })
  })

  it("encodes a declined ruling as markOutOfScope", () => {
    const data = encodeRuling(requestId(0xabc), "outOfScope", CONTEXT)

    expect(data.slice(0, 10)).toBe("0x4ffcdfa1")
    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "markOutOfScope",
      args: [requestId(0xabc), CONTEXT],
    })
  })
})

describe("submitRuling", () => {
  it("proposes a single call to the oracle through the Safe", async () => {
    const send = vi.fn(async () => ({ safeTxHash: "0xhash" }))
    const sdk = { txs: { send } } as unknown as SafeAppsSDK

    const result = await submitRuling(sdk, CONFIG.oracleAddress, requestId(1), "deny", "no")

    expect(result).toEqual({ safeTxHash: "0xhash" })
    expect(send).toHaveBeenCalledWith({
      txs: [{ to: CONFIG.oracleAddress, value: "0", data: encodeRuling(requestId(1), "deny", "no") }],
    })
  })
})
