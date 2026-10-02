import { encodeAbiParameters, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { COMMIT_WINDOW, CONFIG, mockOracleSdk, proposalLog, SAFE_TRANSACTION } from "@/__tests__/mock-sentinel-oracle"
import { calculateSafeTxHash, fetchRequestProposal, oracleRequestId } from "@/lib/requestProposal"

// Computed independently with `cast abi-encode` and `cast keccak`, following the Safe contracts' `SafeTx` EIP-712
// encoding, for the unchanged `SAFE_TRANSACTION` (chain 1, nonce 42, DelegateCall).
const SAFE_TX_HASH = "0xc8c4b60cceb7835a22a7049e50dc07d52511c485db96bc919ced371de9df8b32"

const requestAt = (requestId: Hex, block: number) => ({
  requestId,
  commitDeadline: BigInt(block + COMMIT_WINDOW),
})

describe("oracleRequestId", () => {
  it("matches the attestation message `Consensus` computes for a proposal", () => {
    // Computed independently with `cast`, following `ConsensusMessages.transactionProposal`'s encoding.
    expect(
      oracleRequestId({
        chainId: 100,
        consensus: "0x0000000000000000000000000000000000000c05",
        epoch: 7n,
        oracle: "0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0",
        oracleData: "0x1234",
        safeTxHash: `0x${"5a".repeat(32)}`,
      }),
    ).toBe("0xb60bab99e03ab904eced85df67325104c956904a0085d82e752a6faf8e167da3")
  })
})

describe("calculateSafeTxHash", () => {
  it("matches the hash the Safe contract signs for a transaction on its own chain", () => {
    expect(calculateSafeTxHash(SAFE_TRANSACTION)).toBe(SAFE_TX_HASH)
  })
})

describe("fetchRequestProposal", () => {
  it.each(["emitter", "block", "oracle"] as const)("rejects a provider log outside the %s filter", async (field) => {
    const { id, log } = proposalLog({}, 50)
    const other = "0x4444444444444444444444444444444444444444"
    if (field === "emitter") log.address = other
    if (field === "block") log.blockNumber = 49
    if (field === "oracle") {
      log.topics = [...log.topics.slice(0, 3), encodeAbiParameters([{ type: "address" }], [other])]
    }
    const { sdk, getPastLogs } = mockOracleSdk([], {})
    getPastLogs.mockResolvedValue([log])
    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).rejects.toThrow(/outside.*filter/)
  })

  it("returns the verified proposal for the exact request among same-block proposals", async () => {
    const otherEpoch = proposalLog({ epoch: 6n, safeTxHash: SAFE_TX_HASH }, 50, 0)
    const otherData = proposalLog({ oracleData: "0x01", safeTxHash: SAFE_TX_HASH }, 50, 1)
    const { id, log } = proposalLog({ oracleData: "0xabcd", safeTxHash: SAFE_TX_HASH }, 50, 2)
    const { sdk } = mockOracleSdk([otherEpoch.log, otherData.log, log], {})

    const proposal = await fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))

    expect(proposal).toEqual({
      blockNumber: 50,
      transactionHash: log.transactionHash,
      epoch: 7n,
      oracleData: "0xabcd",
      safeTxHash: SAFE_TX_HASH,
      transaction: SAFE_TRANSACTION,
    })
  })

  it("shows a transaction from another chain than the arbitration chain", async () => {
    const { id, log } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk } = mockOracleSdk([log], {})

    const proposal = await fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))

    expect(BigInt(CONFIG.chainId)).not.toBe(SAFE_TRANSACTION.chainId)
    expect(proposal?.transaction.chainId).toBe(SAFE_TRANSACTION.chainId)
  })

  it.each([
    ["epoch", { epoch: 8n }],
    ["oracle data", { oracleData: "0x01" }],
  ] as const)("returns null when the only proposal has a different %s", async (_, change) => {
    const { log } = proposalLog({ ...change, safeTxHash: SAFE_TX_HASH }, 50)
    const { id } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk } = mockOracleSdk([log], {})

    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).resolves.toBeNull()
  })

  it("only looks in the block the commit deadline implies", async () => {
    const { id, log: before } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 49)
    const { log: after } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 51)
    const { sdk } = mockOracleSdk([before, after], {})

    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).resolves.toBeNull()
  })

  it.each([
    ["transaction nonce", { nonce: 43n }],
    ["transaction target", { to: "0x8080808080808080808080808080808080808080" }],
    ["transaction calldata", { data: "0xdeadbeee" }],
    ["original chain", { chainId: 100n }],
  ] as const)("rejects a matching proposal whose %s differs from its hash", async (_, change) => {
    const transaction = { ...SAFE_TRANSACTION, ...change }
    const { id, log } = proposalLog({ transaction, safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk } = mockOracleSdk([log], {})

    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).rejects.toThrow(
      `not the declared ${SAFE_TX_HASH}`,
    )
  })

  it("accepts a proposal at the deployment block", async () => {
    const { id, log } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk } = mockOracleSdk([log], {})

    const proposal = await fetchRequestProposal(sdk, { ...CONFIG, deploymentBlock: 50 }, requestAt(id, 50))

    expect(proposal?.blockNumber).toBe(50)
  })

  it.each([
    ["before the deployment block", { ...CONFIG, deploymentBlock: 51 }, BigInt(50 + COMMIT_WINDOW)],
    ["before block zero", CONFIG, BigInt(COMMIT_WINDOW - 1)],
    ["beyond exact block precision", CONFIG, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(COMMIT_WINDOW) + 1n],
  ] as const)("rejects a commit deadline implying a block %s", async (_, config, commitDeadline) => {
    const { id } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk, getPastLogs } = mockOracleSdk([], {})

    await expect(fetchRequestProposal(sdk, config, { requestId: id, commitDeadline })).rejects.toThrow(
      "outside the oracle's history",
    )
    expect(getPastLogs).not.toHaveBeenCalled()
  })

  it("reports a provider failure instead of a missing proposal", async () => {
    const { id } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk, getPastLogs } = mockOracleSdk([], {})
    getPastLogs.mockRejectedValueOnce(new Error("rpc unavailable"))

    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).rejects.toThrow("rpc unavailable")
  })

  it("reports an undecodable event instead of skipping it", async () => {
    const { id, log } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const { sdk } = mockOracleSdk([{ ...log, data: "0x" }], {})

    await expect(fetchRequestProposal(sdk, CONFIG, requestAt(id, 50))).rejects.toThrow(
      `Undecodable TransactionProposed log in transaction ${log.transactionHash}`,
    )
  })

  it("takes contract constants from the first reader and the event only from the logs RPC", async () => {
    const { id, log } = proposalLog({ safeTxHash: SAFE_TX_HASH }, 50)
    const authoritative = mockOracleSdk([], {})
    const archive = mockOracleSdk([log], {})
    archive.call.mockRejectedValue(new Error("an archive RPC is never asked for contract state"))

    const proposal = await fetchRequestProposal(authoritative.sdk, CONFIG, requestAt(id, 50), archive.sdk)

    expect(proposal?.transactionHash).toBe(log.transactionHash)
    expect(authoritative.getPastLogs).not.toHaveBeenCalled()
    expect(archive.call).not.toHaveBeenCalled()
  })
})
