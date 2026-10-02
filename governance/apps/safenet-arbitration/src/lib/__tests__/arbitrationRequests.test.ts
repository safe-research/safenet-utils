import type { Log } from "@safe-global/safe-apps-sdk"
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, numberToHex, parseAbi } from "viem"
import { describe, expect, it, type Mock, vi } from "vitest"
import { CONFIG, disputeLog, mockOracleSdk, type RequestFixture, requestId } from "@/__tests__/mock-sentinel-oracle"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { type ArbitrationRequestsSnapshot, fetchArbitrationRequests, openDisputes } from "@/lib/arbitrationRequests"
import type { ReadRpc } from "@/lib/rpc"

const config = { ...CONFIG, deploymentBlock: 100, logBlockRange: 10 }

const FROZEN = { state: RequestState.FROZEN } as const

const SPONSOR_A: Address = "0x2222222222222222222222222222222222222222"
const SPONSOR_B: Address = "0x3333333333333333333333333333333333333333"

// A request id that no fixture block has used as its hash.
const REPLACEMENT_HASH = requestId(9_001)

function trigger(n: number, block: number, logIndex = 0) {
  return disputeLog("DisputeTriggered", requestId(n), block, logIndex)
}

function frozen(...numbers: number[]): Record<Hex, RequestFixture> {
  return Object.fromEntries(numbers.map((n): [Hex, RequestFixture] => [requestId(n), FROZEN]))
}

function idsOf(snapshot: ArbitrationRequestsSnapshot) {
  return snapshot.requests.map((request) => request.requestId)
}

// Runs steps from `previous` until both the history and the live cursor have caught up.
async function scan(rpc: ReadRpc, previous?: ArbitrationRequestsSnapshot, lookbackBlocks?: number | null) {
  let snapshot = previous
  for (let step = 0; step < 50; step++) {
    snapshot = await fetchArbitrationRequests(rpc, config, { previous: snapshot, lookbackBlocks })
    if (snapshot.historyToBlock === null && snapshot.liveThroughBlock === snapshot.observedBlock) return snapshot
  }
  throw new Error("The scan did not catch up")
}

// Wraps a fixture RPC method, e.g. to fail it or to change the chain while a call is in flight.
function wrapRpc<Args extends unknown[], Result>(
  mock: Mock<(...args: Args) => Promise<Result>>,
  wrapper: (original: (...args: Args) => Promise<Result>, ...args: Args) => Promise<Result>,
) {
  const original = mock.getMockImplementation()
  if (!original) throw new Error("The RPC mock has no implementation")
  mock.mockImplementation((...args) => wrapper(original, ...args))
}

function beforeRpc<Args extends unknown[], Result>(
  mock: Mock<(...args: Args) => Promise<Result>>,
  before: (...args: Args) => void,
) {
  wrapRpc(mock, async (original, ...args) => {
    before(...args)
    return original(...args)
  })
}

type FilterCalls = {
  mock: { calls: readonly (readonly [readonly [{ fromBlock: number | Hex; toBlock: number | Hex }]])[] }
}

// The inclusive block ranges whose dispute logs were requested, oldest first.
function searchedRanges({ mock }: FilterCalls) {
  return mock.calls
    .map(([[filter]]): [number, number] => [Number(filter.fromBlock), Number(filter.toBlock)])
    .sort(([left], [right]) => left - right)
}

describe("openDisputes", () => {
  it("keeps triggered disputes that were never settled, with their trigger positions", () => {
    const logs = [
      trigger(1, 5),
      trigger(2, 5, 1),
      trigger(3, 6, 4),
      trigger(4, 7),
      disputeLog("DisputeResolved", requestId(1), 8),
      disputeLog("DisputeOutOfScope", requestId(2), 8, 1),
      disputeLog("ArbitrationTimedOut", requestId(4), 9),
    ]

    expect(openDisputes(logs)).toEqual([{ requestId: requestId(3), triggerBlock: 6, triggerLogIndex: 4 }])
  })

  it("lists disputes in the order they were triggered", () => {
    const open = openDisputes([trigger(2, 5), trigger(1, 5, 1), trigger(3, 9)])

    expect(open.map((dispute) => dispute.requestId)).toEqual([requestId(2), requestId(1), requestId(3)])
  })

  it("refuses an event outside the dispute lifecycle instead of treating it as a settlement", () => {
    const abi = parseAbi(["event Committed(bytes32 indexed requestId, address indexed sentinel, uint96 bondAmount)"])
    const args = { requestId: requestId(1), sentinel: SPONSOR_A }
    const committed: Log = {
      ...trigger(1, 6),
      topics: encodeEventTopics({ abi, eventName: "Committed", args }) as Hex[],
      data: encodeAbiParameters([{ type: "uint96" }], [1n]),
    }

    expect(() => openDisputes([trigger(1, 5), committed])).toThrow()
  })
})

describe("fetchArbitrationRequests", () => {
  it("walks back from an empty newest page to the oldest cases, deployment block included", async () => {
    const logs = [trigger(1, 110), trigger(2, 100), trigger(3, 99)]
    const { sdk } = mockOracleSdk(logs, frozen(1, 2, 3), 150)

    const first = await fetchArbitrationRequests(sdk, config)
    const done = await scan(sdk, first)

    expect(first).toMatchObject({
      requests: [],
      searchFromBlock: 100,
      historyToBlock: 140,
      liveThroughBlock: 150,
      observedBlock: 150,
      generation: 0,
    })
    expect(idsOf(done)).toEqual([requestId(1), requestId(2)])
    expect(done.historyToBlock).toBeNull()
  })

  it("projects each frozen request's on-chain state, newest dispute first, keeping overdue ones", async () => {
    const logs = [trigger(1, 110), trigger(2, 120, 1), trigger(3, 120, 5), trigger(4, 130)]
    const { sdk } = mockOracleSdk(
      logs,
      {
        // Overdue at head 150, yet still waiting for a ruling.
        [requestId(1)]: {
          state: RequestState.FROZEN,
          sponsor: SPONSOR_A,
          commitDeadline: 77n,
          approve: 3,
          deny: 2,
          committedCount: 9,
          revealedCount: 6,
          deadline: 120n,
        },
        [requestId(2)]: { state: RequestState.FROZEN, sponsor: SPONSOR_B, deadline: 150n },
        [requestId(3)]: {
          state: RequestState.FROZEN,
          sponsor: SPONSOR_B,
          commitDeadline: 12n,
          approve: 1,
          deadline: 500n,
        },
        // Settled on-chain, but its settlement log isn't visible: on-chain state wins.
        [requestId(4)]: { state: RequestState.RESOLVED_DENIED },
      },
      150,
    )

    const { requests } = await scan(sdk)

    expect(requests).toEqual([
      {
        requestId: requestId(3),
        triggerBlock: 120,
        triggerLogIndex: 5,
        commitDeadline: 12n,
        sponsor: SPONSOR_B,
        approveCount: 1,
        denyCount: 0,
        committedCount: 1,
        revealedCount: 1,
        arbitrationDeadline: 500n,
      },
      {
        requestId: requestId(2),
        triggerBlock: 120,
        triggerLogIndex: 1,
        commitDeadline: 11n,
        sponsor: SPONSOR_B,
        approveCount: 0,
        denyCount: 0,
        committedCount: 0,
        revealedCount: 0,
        arbitrationDeadline: 150n,
      },
      {
        requestId: requestId(1),
        triggerBlock: 110,
        triggerLogIndex: 0,
        commitDeadline: 77n,
        sponsor: SPONSOR_A,
        approveCount: 3,
        denyCount: 2,
        committedCount: 9,
        revealedCount: 6,
        arbitrationDeadline: 120n,
      },
    ])
  })

  it("lists a request once although the RPC returns its log twice", async () => {
    const { sdk } = mockOracleSdk([trigger(1, 120), trigger(1, 120)], frozen(1), 150)

    expect(idsOf(await scan(sdk))).toEqual([requestId(1)])
  })

  it("keeps its progress when a page fails, and the retry finds the case on that page", async () => {
    const { sdk, getPastLogs } = mockOracleSdk([trigger(1, 110)], frozen(1), 150)
    let unavailable = true
    beforeRpc(getPastLogs, ([filter]) => {
      if (unavailable && Number(filter.fromBlock) <= 110 && Number(filter.toBlock) >= 110) {
        throw new Error("rpc down")
      }
    })
    let snapshot = await fetchArbitrationRequests(sdk, config)
    for (let page = 0; page < 3; page++) {
      snapshot = await fetchArbitrationRequests(sdk, config, { previous: snapshot })
    }
    const lastGood = structuredClone(snapshot)

    await expect(fetchArbitrationRequests(sdk, config, { previous: snapshot })).rejects.toThrow("rpc down")
    unavailable = false
    const retried = await scan(sdk, snapshot)

    expect(snapshot).toEqual(lastGood)
    expect(lastGood.historyToBlock).toBe(110)
    expect(idsOf(retried)).toEqual([requestId(1)])
  })

  it("does not skip a newer page whose request state read failed", async () => {
    const logs: Log[] = []
    const requests: Record<Hex, RequestFixture> = {}
    const { sdk, head, call } = mockOracleSdk(logs, requests, 130)
    const caughtUp = await scan(sdk)
    const lastGood = structuredClone(caughtUp)
    logs.push(trigger(1, 133))
    requests[requestId(1)] = FROZEN
    head.number = 135
    let unavailable = true
    beforeRpc(call, () => {
      if (unavailable) throw new Error("state read failed")
    })

    await expect(fetchArbitrationRequests(sdk, config, { previous: caughtUp })).rejects.toThrow("state read failed")
    unavailable = false
    const retried = await scan(sdk, caughtUp)

    expect(caughtUp).toEqual(lastGood)
    expect(idsOf(retried)).toEqual([requestId(1)])
  })

  it("advances the older page and the newer page in the same step", async () => {
    const logs = [trigger(1, 135)]
    const requests = frozen(1)
    const { sdk, head } = mockOracleSdk(logs, requests, 150)
    const first = await fetchArbitrationRequests(sdk, config)
    head.number = 165
    logs.push(trigger(2, 155))
    requests[requestId(2)] = FROZEN

    const second = await fetchArbitrationRequests(sdk, config, { previous: first })

    expect(idsOf(second)).toEqual([requestId(2), requestId(1)])
    expect(second).toMatchObject({ historyToBlock: 130, liveThroughBlock: 160, observedBlock: 165, generation: 0 })
  })

  it("catches up on newer blocks page by page, newest dispute first, without rescanning history", async () => {
    const logs = [trigger(1, 110)]
    const requests = frozen(1)
    const { sdk, head } = mockOracleSdk(logs, requests, 150)
    const complete = await scan(sdk)
    head.number = 165
    logs.push(trigger(2, 163))
    requests[requestId(2)] = FROZEN

    const partial = await fetchArbitrationRequests(sdk, config, { previous: complete })
    const caughtUp = await fetchArbitrationRequests(sdk, config, { previous: partial })

    expect(partial).toMatchObject({ liveThroughBlock: 160, observedBlock: 165, historyToBlock: null, generation: 0 })
    expect(idsOf(partial)).toEqual([requestId(1)])
    expect(idsOf(caughtUp)).toEqual([requestId(2), requestId(1)])
    expect(caughtUp.liveThroughBlock).toBe(165)
  })

  it.each([RequestState.RESOLVED_APPROVED, RequestState.RESOLVED_DENIED, RequestState.TIMED_OUT])(
    "drops a retained request that reached state %s without any settlement log in the new blocks",
    async (state) => {
      const requests = frozen(1, 2)
      const { sdk, head } = mockOracleSdk([trigger(1, 110), trigger(2, 120)], requests, 150)
      const complete = await scan(sdk)
      requests[requestId(1)] = { state }
      head.number = 151

      const refreshed = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(idsOf(complete)).toEqual([requestId(2), requestId(1)])
      expect(idsOf(refreshed)).toEqual([requestId(2)])
    },
  )

  it("keeps a pinned view when a new block settles a request during the read", async () => {
    const logs = [trigger(1, 145)]
    const { sdk, head, call } = mockOracleSdk(logs, frozen(1), 150)
    const newer = mockOracleSdk(logs, { [requestId(1)]: { state: RequestState.TIMED_OUT } }, 151)
    wrapRpc(call, async (original, ...args) => {
      head.number = 151
      return args[0][1] === numberToHex(150) ? original(...args) : newer.call(...args)
    })

    const pinned = await fetchArbitrationRequests(sdk, config)
    expect(pinned.observedBlock).toBe(150)
    expect(idsOf(pinned)).toEqual([requestId(1)])
    expect(idsOf(await fetchArbitrationRequests(sdk, config, { previous: pinned }))).toEqual([])
  })

  it("reads every case without exceeding the provider rate limit", async () => {
    vi.useFakeTimers()
    try {
      const numbers = Array.from({ length: 45 }, (_, i) => i + 1)
      const logs = numbers.map((n) => trigger(n, 145))
      const { sdk, call } = mockOracleSdk(logs, frozen(...numbers), 150)
      let starts: number[] = []
      wrapRpc(call, async (original, ...args) => {
        starts = starts.filter((time) => Date.now() - time < 300)
        if (starts.length >= 3) throw new Error("RPC rate limit exceeded")
        starts.push(Date.now())
        return original(...args)
      })
      const completion = fetchArbitrationRequests(sdk, config).then(
        (snapshot) => ({ snapshot, error: undefined }),
        (error: unknown) => ({ snapshot: undefined, error }),
      )
      await vi.runAllTimersAsync()
      const { snapshot, error } = await completion
      expect(error).toBeUndefined()
      expect(new Set(idsOf(snapshot!))).toEqual(new Set(numbers.map(requestId)))
    } finally {
      vi.useRealTimers()
    }
  })

  describe("when the observed block leaves the chain", () => {
    const logs = () => [trigger(1, 110), trigger(2, 145)]

    it("restarts at the head with a new generation when the observed block was replaced", async () => {
      const { sdk, blockHashes } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      blockHashes.set(150, REPLACEMENT_HASH)

      const restarted = await fetchArbitrationRequests(sdk, config, { previous: complete })
      const rescanned = await scan(sdk, restarted)

      expect(idsOf(complete)).toEqual([requestId(2), requestId(1)])
      expect(restarted).toMatchObject({
        generation: 1,
        observedBlock: 150,
        observedBlockHash: REPLACEMENT_HASH,
        historyToBlock: 140,
        liveThroughBlock: 150,
      })
      expect(idsOf(restarted)).toEqual([requestId(2)])
      expect(idsOf(rescanned)).toEqual([requestId(2), requestId(1)])
      expect(rescanned.generation).toBe(1)
    })

    it("restarts when the observed block was replaced and the head has moved on", async () => {
      const { sdk, head, blockHashes } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      blockHashes.set(150, REPLACEMENT_HASH)
      head.number = 160

      const restarted = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(restarted).toMatchObject({ generation: 1, observedBlock: 160, liveThroughBlock: 160, historyToBlock: 150 })
      expect(idsOf(restarted)).toEqual([])
    })

    it("restarts without looking up the vanished block when the head moves backwards", async () => {
      const { sdk, head, getBlockByNumber } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      head.number = 140
      beforeRpc(getBlockByNumber, ([block] = ["latest"]) => {
        if (block !== "latest" && Number(block) > head.number) throw new Error("Unknown future block")
      })

      const restarted = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(restarted).toMatchObject({ generation: 1, observedBlock: 140, liveThroughBlock: 140, historyToBlock: 130 })
      expect(idsOf(restarted)).toEqual([])
    })

    it("keeps the generation while the head advances along the same chain", async () => {
      const { sdk, head } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      head.number = 158

      const advanced = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(advanced.generation).toBe(0)
      expect(idsOf(advanced)).toEqual([requestId(2), requestId(1)])
    })

    it("rejects, rather than resets, when the observed block's header can't be read", async () => {
      const { sdk, head, getBlockByNumber } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      head.number = 155
      let unavailable = true
      beforeRpc(getBlockByNumber, (block) => {
        if (unavailable && block?.[0] === 150) throw new Error("header unavailable")
      })

      await expect(fetchArbitrationRequests(sdk, config, { previous: complete })).rejects.toThrow("header unavailable")
      unavailable = false
      const retried = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(retried).toMatchObject({ generation: 0, observedBlock: 155 })
    })

    it("rejects a step whose head block was replaced mid-read, and the retry builds on the new chain", async () => {
      const { sdk, head, blockHashes, getPastLogs } = mockOracleSdk(logs(), frozen(1, 2), 150)
      const complete = await scan(sdk)
      head.number = 151
      let replace = true
      beforeRpc(getPastLogs, () => {
        if (replace) blockHashes.set(151, REPLACEMENT_HASH)
        replace = false
      })

      await expect(fetchArbitrationRequests(sdk, config, { previous: complete })).rejects.toThrow("changed while")
      const retried = await fetchArbitrationRequests(sdk, config, { previous: complete })

      expect(retried).toMatchObject({ generation: 0, observedBlock: 151, observedBlockHash: REPLACEMENT_HASH })
    })
  })

  it("fails, rather than report an empty list, when the head is before the deployment block", async () => {
    const { sdk } = mockOracleSdk([], {}, 99)

    await expect(fetchArbitrationRequests(sdk, config)).rejects.toThrow("deployment block")
  })

  it("rejects a header the RPC can't vouch for", async () => {
    const { sdk, blockHashes } = mockOracleSdk([], {}, 150)
    blockHashes.set(150, "0x1234")

    await expect(fetchArbitrationRequests(sdk, config)).rejects.toThrow()
  })

  describe("lookback window", () => {
    it("searches exactly the newest N blocks, the head included, and nothing older", async () => {
      const logs = [trigger(1, 130), trigger(2, 131), trigger(3, 150)]
      const { sdk, getPastLogs } = mockOracleSdk(logs, frozen(1, 2, 3), 150)

      const done = await scan(sdk, undefined, 20)

      expect(idsOf(done)).toEqual([requestId(3), requestId(2)])
      expect(done).toMatchObject({ searchFromBlock: 131, historyToBlock: null })
      expect(searchedRanges(getPastLogs)).toEqual([
        [131, 140],
        [141, 150],
      ])
    })

    it.each([1000, Number.MAX_SAFE_INTEGER])(
      "never searches below the deployment block for a lookback of %d blocks",
      async (lookbackBlocks) => {
        const { sdk, getPastLogs } = mockOracleSdk([trigger(1, 100), trigger(2, 99)], frozen(1, 2), 150)

        const done = await scan(sdk, undefined, lookbackBlocks)

        expect(idsOf(done)).toEqual([requestId(1)])
        expect(done.searchFromBlock).toBe(100)
        expect(searchedRanges(getPastLogs)[0]).toEqual([100, 100])
      },
    )

    it.each([undefined, null])("searches the whole deployment history for a lookback of %s", async (lookbackBlocks) => {
      const { sdk } = mockOracleSdk([trigger(1, 100), trigger(2, 140)], frozen(1, 2), 150)

      const done = await scan(sdk, undefined, lookbackBlocks)

      expect(idsOf(done)).toEqual([requestId(2), requestId(1)])
      expect(done.searchFromBlock).toBe(100)
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      "rejects a lookback of %d blocks before reading anything",
      async (lookbackBlocks) => {
        const { sdk, getBlockByNumber } = mockOracleSdk([], {}, 150)

        await expect(fetchArbitrationRequests(sdk, config, { lookbackBlocks })).rejects.toThrow(RangeError)
        expect(getBlockByNumber).not.toHaveBeenCalled()
      },
    )

    it("drops disputes that fall out of the window as the head advances, and finds the new ones", async () => {
      const logs = [trigger(1, 135), trigger(2, 145)]
      const requests: Record<Hex, RequestFixture> = {
        ...frozen(1),
        // Overdue at the new head, yet still waiting for a ruling.
        [requestId(2)]: { state: RequestState.FROZEN, deadline: 100n },
      }
      const { sdk, head, getPastLogs } = mockOracleSdk(logs, requests, 150)
      const complete = await scan(sdk, undefined, 20)
      head.number = 160
      logs.push(trigger(3, 158))
      requests[requestId(3)] = FROZEN
      getPastLogs.mockClear()

      const advanced = await fetchArbitrationRequests(sdk, config, { previous: complete, lookbackBlocks: 20 })

      expect(idsOf(complete)).toEqual([requestId(2), requestId(1)])
      expect(idsOf(advanced)).toEqual([requestId(3), requestId(2)])
      expect(advanced).toMatchObject({ searchFromBlock: 141, historyToBlock: null, generation: 0 })
      expect(searchedRanges(getPastLogs)).toEqual([[151, 160]])
    })

    it("skips blocks that left the window before they were searched", async () => {
      const logs = [trigger(1, 140)]
      const requests = frozen(1)
      const { sdk, head, getPastLogs } = mockOracleSdk(logs, requests, 150)
      const complete = await scan(sdk, undefined, 20)
      // 153 is FROZEN but older than the window at the new head; 160 is inside it.
      logs.push(trigger(2, 153), trigger(3, 160))
      Object.assign(requests, frozen(2, 3))
      head.number = 175
      getPastLogs.mockClear()

      const advanced = await scan(sdk, complete, 20)

      expect(idsOf(complete)).toEqual([requestId(1)])
      expect(idsOf(advanced)).toEqual([requestId(3)])
      expect(searchedRanges(getPastLogs)).toEqual([
        [156, 165],
        [166, 175],
      ])
    })

    it("searches the blocks a larger window newly covers rather than report the old coverage as complete", async () => {
      const logs = [trigger(1, 120), trigger(2, 140), trigger(3, 100)]
      const { sdk, getPastLogs } = mockOracleSdk(logs, frozen(1, 2, 3), 150)
      const bounded = await scan(sdk, undefined, 20)
      const boundedBefore = structuredClone(bounded)
      getPastLogs.mockClear()

      const expanding = await fetchArbitrationRequests(sdk, config, { previous: bounded, lookbackBlocks: null })
      const full = await scan(sdk, expanding, null)

      expect(idsOf(bounded)).toEqual([requestId(2)])
      expect(bounded).toEqual(boundedBefore)
      expect(expanding).toMatchObject({ searchFromBlock: 100, historyToBlock: 120 })
      expect(idsOf(full)).toEqual([requestId(2), requestId(1), requestId(3)])
      expect(searchedRanges(getPastLogs)).toEqual([
        [100, 100],
        [101, 110],
        [111, 120],
        [121, 130],
      ])
    })

    it("keeps its coverage and discovers the case on retry when an expanded page fails", async () => {
      const { sdk, getPastLogs } = mockOracleSdk([trigger(1, 120)], frozen(1), 150)
      const bounded = await scan(sdk, undefined, 20)
      const expanding = await fetchArbitrationRequests(sdk, config, { previous: bounded, lookbackBlocks: 40 })
      const lastGood = structuredClone(expanding)
      let unavailable = true
      beforeRpc(getPastLogs, ([filter]) => {
        if (unavailable && Number(filter.fromBlock) <= 120 && Number(filter.toBlock) >= 120) {
          throw new Error("rpc down")
        }
      })

      const failed = fetchArbitrationRequests(sdk, config, { previous: expanding, lookbackBlocks: 40 })
      await expect(failed).rejects.toThrow("rpc down")
      unavailable = false
      const retried = await scan(sdk, expanding, 40)

      expect(expanding).toEqual(lastGood)
      expect(idsOf(expanding)).toEqual([])
      expect(idsOf(retried)).toEqual([requestId(1)])
    })

    it("drops disputes older than a smaller window without searching again", async () => {
      const logs = [trigger(1, 120), trigger(2, 140)]
      const { sdk, getPastLogs } = mockOracleSdk(logs, frozen(1, 2), 150)
      const wide = await scan(sdk, undefined, 40)
      getPastLogs.mockClear()

      const narrow = await fetchArbitrationRequests(sdk, config, { previous: wide, lookbackBlocks: 20 })

      expect(idsOf(wide)).toEqual([requestId(2), requestId(1)])
      expect(idsOf(narrow)).toEqual([requestId(2)])
      expect(narrow).toMatchObject({ searchFromBlock: 131, historyToBlock: null })
      expect(searchedRanges(getPastLogs)).toEqual([])
    })

    it("finishes an unfinished walk when the window shrinks past its cursor", async () => {
      const logs = [trigger(1, 145), trigger(2, 120)]
      const { sdk, getPastLogs } = mockOracleSdk(logs, frozen(1, 2), 150)
      const walking = await fetchArbitrationRequests(sdk, config, { lookbackBlocks: 45 })
      getPastLogs.mockClear()

      const narrow = await fetchArbitrationRequests(sdk, config, { previous: walking, lookbackBlocks: 5 })

      expect(walking).toMatchObject({ historyToBlock: 140 })
      expect(idsOf(walking)).toEqual([requestId(1)])
      expect(idsOf(narrow)).toEqual([])
      expect(narrow).toMatchObject({ searchFromBlock: 146, historyToBlock: null })
      expect(searchedRanges(getPastLogs)).toEqual([])
    })

    it("restarts the window at the new head after the observed block was replaced", async () => {
      const { sdk, head, blockHashes } = mockOracleSdk([trigger(1, 135)], frozen(1), 150)
      const complete = await scan(sdk, undefined, 20)
      blockHashes.set(150, REPLACEMENT_HASH)
      head.number = 160

      const restarted = await fetchArbitrationRequests(sdk, config, { previous: complete, lookbackBlocks: 20 })
      const rescanned = await scan(sdk, restarted, 20)

      expect(idsOf(complete)).toEqual([requestId(1)])
      expect(restarted).toMatchObject({
        generation: 1,
        searchFromBlock: 141,
        historyToBlock: 150,
        liveThroughBlock: 160,
      })
      expect(idsOf(rescanned)).toEqual([])
    })
  })

  describe("with a separate log source", () => {
    // What an untrusted archive could claim about every request it knows of.
    const FORGED = { state: RequestState.FROZEN, sponsor: SPONSOR_B, approve: 9, deny: 9, committedCount: 99 } as const

    it("takes candidates from the log source but the head and every state from the first reader", async () => {
      const authoritative = mockOracleSdk(
        [],
        {
          [requestId(1)]: { state: RequestState.RESOLVED_DENIED },
          [requestId(2)]: { state: RequestState.FROZEN, sponsor: SPONSOR_A, approve: 2, committedCount: 3 },
          [requestId(3)]: { state: RequestState.TIMED_OUT },
        },
        150,
      )
      // The archive reports another chain head and claims all three requests are still open.
      const archive = mockOracleSdk(
        [trigger(1, 141), trigger(2, 145), trigger(3, 148)],
        { [requestId(1)]: FORGED, [requestId(2)]: FORGED, [requestId(3)]: FORGED },
        999,
      )

      const snapshot = await fetchArbitrationRequests(authoritative.sdk, config, {
        logsRpc: archive.sdk,
        lookbackBlocks: 10,
      })

      expect(snapshot).toMatchObject({ observedBlock: 150, searchFromBlock: 141, historyToBlock: null })
      expect(snapshot.requests).toMatchObject([
        { requestId: requestId(2), sponsor: SPONSOR_A, approveCount: 2, denyCount: 0, committedCount: 3 },
      ])
    })

    it("fails, rather than fall back to the log source, when the first reader can't read a state", async () => {
      const authoritative = mockOracleSdk([], {}, 150)
      const archive = mockOracleSdk([trigger(1, 145)], { [requestId(1)]: FORGED }, 150)

      await expect(fetchArbitrationRequests(authoritative.sdk, config, { logsRpc: archive.sdk })).rejects.toThrow()
      expect(archive.call).not.toHaveBeenCalled()
    })
  })

  describe("cancellation", () => {
    it("doesn't touch the RPC once cancelled", async () => {
      const { sdk, getBlockByNumber } = mockOracleSdk([], {}, 150)
      const controller = new AbortController()
      controller.abort()

      const step = fetchArbitrationRequests(sdk, config, { signal: controller.signal })

      await expect(step).rejects.toHaveProperty("name", "AbortError")
      expect(getBlockByNumber).not.toHaveBeenCalled()
    })

    it("publishes nothing when cancelled while request states are being read", async () => {
      const { sdk, call } = mockOracleSdk([trigger(1, 145)], frozen(1), 150)
      const controller = new AbortController()
      beforeRpc(call, () => controller.abort())

      const step = fetchArbitrationRequests(sdk, config, { signal: controller.signal })

      await expect(step).rejects.toHaveProperty("name", "AbortError")
    })

    it("does not use the old RPC scope after cancellation during a batch delay", async () => {
      vi.useFakeTimers()
      try {
        const numbers = [1, 2, 3, 4, 5, 6]
        const { sdk, call } = mockOracleSdk(
          numbers.map((n) => trigger(n, 145)),
          frozen(...numbers),
          150,
        )
        const controller = new AbortController()
        beforeRpc(call, () => {
          if (controller.signal.aborted) throw new Error("Obsolete RPC bridge")
        })
        const completion = fetchArbitrationRequests(sdk, config, { signal: controller.signal }).catch(
          (error: unknown) => error,
        )
        setTimeout(() => controller.abort(), 100)
        await vi.runAllTimersAsync()
        expect(await completion).toHaveProperty("name", "AbortError")
      } finally {
        vi.useRealTimers()
      }
    })

    it("publishes nothing when cancelled during the final head check", async () => {
      const { sdk, getBlockByNumber } = mockOracleSdk([trigger(1, 145)], frozen(1), 150)
      const controller = new AbortController()
      beforeRpc(getBlockByNumber, (block) => {
        if (block?.[0] === 150) controller.abort()
      })

      const step = fetchArbitrationRequests(sdk, config, { signal: controller.signal })

      await expect(step).rejects.toHaveProperty("name", "AbortError")
    })
  })
})
