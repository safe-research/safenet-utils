import { describe, expect, it } from "vitest"
import {
  COMMIT_WINDOW,
  CONFIG,
  CONSENSUS,
  mockOracleSdk,
  proposalLog,
  SAFE_TRANSACTION,
} from "@/__tests__/mock-sentinel-oracle"
import { fetchRequestProposal, oracleRequestId } from "@/lib/requestProposal"

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

describe("fetchRequestProposal", () => {
  it("returns the proposal whose attestation message is the request ID", async () => {
    const other = proposalLog({ epoch: 6n }, 50)
    const { id, log } = proposalLog({ oracleData: "0xabcd" }, 50)
    const { sdk } = mockOracleSdk([other.log, log], {})

    const proposal = await fetchRequestProposal(sdk, CONFIG, {
      requestId: id,
      commitDeadline: BigInt(50 + COMMIT_WINDOW),
    })

    expect(proposal).toEqual({
      blockNumber: 50,
      transactionHash: log.transactionHash,
      epoch: 7n,
      oracleData: "0xabcd",
      safeTxHash: `0x${"5a".repeat(32)}`,
      transaction: SAFE_TRANSACTION,
    })
  })

  it("only searches the block the request was posted in", async () => {
    const { id } = proposalLog({}, 50)
    const { sdk, getPastLogs } = mockOracleSdk([], {})

    await fetchRequestProposal(sdk, CONFIG, { requestId: id, commitDeadline: BigInt(50 + COMMIT_WINDOW) })

    expect(getPastLogs).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ address: CONSENSUS, fromBlock: 50, toBlock: 50 }),
    ])
  })

  it("returns null when no proposal matches the request", async () => {
    const { log } = proposalLog({}, 50)
    const { id } = proposalLog({ epoch: 8n }, 50)
    const { sdk } = mockOracleSdk([log], {})

    await expect(
      fetchRequestProposal(sdk, CONFIG, { requestId: id, commitDeadline: BigInt(50 + COMMIT_WINDOW) }),
    ).resolves.toBeNull()
  })
})
