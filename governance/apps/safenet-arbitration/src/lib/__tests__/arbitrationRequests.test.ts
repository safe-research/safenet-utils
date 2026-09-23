import { describe, expect, it } from "vitest"
import { CONFIG, disputeLog, mockOracleSdk, requestId } from "@/__tests__/mock-sentinel-oracle"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { fetchArbitrationRequests, openDisputeIds } from "@/lib/arbitrationRequests"

describe("openDisputeIds", () => {
  it("keeps triggered disputes that were never settled", () => {
    const logs = [
      disputeLog("DisputeTriggered", requestId(1)),
      disputeLog("DisputeTriggered", requestId(2)),
      disputeLog("DisputeTriggered", requestId(3)),
      disputeLog("DisputeTriggered", requestId(4)),
      disputeLog("DisputeResolved", requestId(1)),
      disputeLog("DisputeOutOfScope", requestId(2)),
      disputeLog("ArbitrationTimedOut", requestId(4)),
    ]

    expect(openDisputeIds(logs)).toEqual([requestId(3)])
  })

  it("returns nothing without logs", () => {
    expect(openDisputeIds([])).toEqual([])
  })
})

describe("fetchArbitrationRequests", () => {
  it("returns open disputes that are still frozen on-chain, most recently disputed first", async () => {
    const { sdk } = mockOracleSdk(
      [
        disputeLog("DisputeTriggered", requestId(1)),
        disputeLog("DisputeTriggered", requestId(2)),
        disputeLog("DisputeTriggered", requestId(3)),
        disputeLog("DisputeTriggered", requestId(4)),
        disputeLog("DisputeResolved", requestId(4)),
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
        approveCount: 1,
        denyCount: 4,
        arbitrationDeadline: 123n,
      },
      {
        requestId: requestId(1),
        sponsor: "0x2222222222222222222222222222222222222222",
        approveCount: 3,
        denyCount: 2,
        arbitrationDeadline: 500n,
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

    const { fromBlock } = await fetchArbitrationRequests(sdk, CONFIG)

    expect(fromBlock).toBe(90_001)
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
    expect(getBlockByNumber).not.toHaveBeenCalled()
  })

  it("stops at genesis", async () => {
    const { sdk } = mockOracleSdk([], {}, 5_000)

    await expect(fetchArbitrationRequests(sdk, CONFIG)).resolves.toEqual({ requests: [], fromBlock: 0 })
  })
})
