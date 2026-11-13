import { describe, expect, it } from "vitest"
import { blockTimestamp, CONFIG, disputeLog, mockOracleSdk, requestId } from "@/__tests__/mock-sentinel-oracle"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { estimateBlockTimestamp, fetchArbitrationRequests, openDisputes } from "@/lib/arbitrationRequests"

describe("openDisputes", () => {
  it("keeps triggered disputes that were never settled, with the block they were triggered in", () => {
    const logs = [
      disputeLog("DisputeTriggered", requestId(1), 1),
      disputeLog("DisputeTriggered", requestId(2), 2),
      disputeLog("DisputeTriggered", requestId(3), 3),
      disputeLog("DisputeTriggered", requestId(4), 4),
      disputeLog("DisputeResolved", requestId(1), 5),
      disputeLog("DisputeOutOfScope", requestId(2), 6),
      disputeLog("ArbitrationTimedOut", requestId(4), 7),
    ]

    expect(openDisputes(logs)).toEqual([{ requestId: requestId(3), blockNumber: 3 }])
  })

  it("accepts block numbers as hex quantities", () => {
    const log = { ...disputeLog("DisputeTriggered", requestId(1)), blockNumber: "0x2a" as unknown as number }
    expect(openDisputes([log])).toEqual([{ requestId: requestId(1), blockNumber: 42 }])
  })

  it("returns nothing without logs", () => {
    expect(openDisputes([])).toEqual([])
  })
})

describe("fetchArbitrationRequests", () => {
  it("returns open disputes that are still frozen on-chain, most recently disputed first", async () => {
    const { sdk } = mockOracleSdk(
      [
        disputeLog("DisputeTriggered", requestId(1), 30),
        disputeLog("DisputeTriggered", requestId(2), 31),
        disputeLog("DisputeTriggered", requestId(3), 32),
        disputeLog("DisputeTriggered", requestId(4), 33),
        disputeLog("DisputeResolved", requestId(4), 34),
      ],
      {
        [requestId(1)]: {
          state: RequestState.FROZEN,
          sponsor: "0x2222222222222222222222222222222222222222",
          approve: 3,
          deny: 2,
          deadline: 500n,
        },
        // Settled on-chain, but its settlement log isn't (yet) visible: on-chain state wins.
        [requestId(2)]: { state: RequestState.RESOLVED_DENIED },
        [requestId(3)]: {
          state: RequestState.FROZEN,
          sponsor: "0x3333333333333333333333333333333333333333",
          commitDeadline: 77n,
          revealDeadline: 88n,
          approve: 1,
          deny: 4,
          deadline: 123n,
        },
      },
    )

    const { requests } = await fetchArbitrationRequests(sdk, CONFIG)

    expect(requests).toEqual([
      {
        requestId: requestId(3),
        sponsor: "0x3333333333333333333333333333333333333333",
        commitDeadline: 77n,
        revealDeadline: 88n,
        approveCount: 1,
        denyCount: 4,
        arbitrationDeadline: 123n,
        // The mocked chain has 5 second blocks, so the estimate is exact.
        arbitrationDeadlineAt: blockTimestamp(123),
        disputedBlock: 32,
        disputedAt: blockTimestamp(32),
      },
      {
        requestId: requestId(1),
        sponsor: "0x2222222222222222222222222222222222222222",
        commitDeadline: 11n,
        revealDeadline: 21n,
        approveCount: 3,
        denyCount: 2,
        arbitrationDeadline: 500n,
        arbitrationDeadlineAt: blockTimestamp(500),
        disputedBlock: 30,
        disputedAt: blockTimestamp(30),
      },
    ])
  })

  it("only considers disputes triggered within the searched blocks", async () => {
    const { sdk } = mockOracleSdk(
      [disputeLog("DisputeTriggered", requestId(1), 10), disputeLog("DisputeTriggered", requestId(2), 30)],
      {
        [requestId(1)]: { state: RequestState.FROZEN },
        [requestId(2)]: { state: RequestState.FROZEN },
      },
      40,
    )

    const { requests } = await fetchArbitrationRequests(sdk, { ...CONFIG, logBlockRange: 20 })

    expect(requests.map((request) => request.requestId)).toEqual([requestId(2)])
  })

  it("searches the configured oracle's logs over the latest block range first", async () => {
    const { sdk, getPastLogs } = mockOracleSdk([], {}, 100_000)

    const { fromBlock, latest } = await fetchArbitrationRequests(sdk, CONFIG)

    expect(fromBlock).toBe(90_001)
    expect(latest).toEqual({ number: 100_000, timestamp: blockTimestamp(100_000) })
    expect(getPastLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        address: CONFIG.oracleAddress,
        fromBlock: 90_001,
        toBlock: 100_000,
        topics: [expect.arrayContaining([disputeLog("DisputeTriggered", requestId(1)).topics[0]])],
      }),
    ])
  })

  it("continues with the block range just before the previous page", async () => {
    const { sdk, getPastLogs, getBlockByNumber } = mockOracleSdk([], {}, 100_000)

    const { fromBlock } = await fetchArbitrationRequests(sdk, CONFIG, 90_001)

    expect(fromBlock).toBe(80_001)
    expect(getPastLogs).toHaveBeenCalledWith([expect.objectContaining({ fromBlock: 80_001, toBlock: 90_000 })])
    // Only the latest block, as the reference for deadline estimates.
    expect(getBlockByNumber).toHaveBeenCalledExactlyOnceWith(["latest"])
  })

  it("stops at genesis", async () => {
    const { sdk } = mockOracleSdk([], {}, 5_000)

    await expect(fetchArbitrationRequests(sdk, CONFIG)).resolves.toMatchObject({ requests: [], fromBlock: 0 })
  })
})

describe("estimateBlockTimestamp", () => {
  const a = { number: 100, timestamp: 1_000 }
  const b = { number: 200, timestamp: 1_600 }

  it("extrapolates from the average block time of two known blocks", () => {
    expect(estimateBlockTimestamp(300, a, b)).toBe(2_200)
    expect(estimateBlockTimestamp(150, a, b)).toBe(1_300)
    expect(estimateBlockTimestamp(50, b, a)).toBe(700)
  })

  it("has no estimate without two distinct blocks", () => {
    expect(estimateBlockTimestamp(300, b, b)).toBeUndefined()
  })
})
