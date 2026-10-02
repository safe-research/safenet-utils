import type { Log } from "@safe-global/safe-apps-sdk"
import { type Address, encodeAbiParameters, encodeEventTopics, getAddress, type Hex, keccak256, toHex } from "viem"
import { describe, expect, it, type Mock } from "vitest"
import { CONFIG, disputeLog, mockOracleSdk, requestId } from "@/__tests__/mock-sentinel-oracle"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { fetchSentinelActivity, type SentinelActivity } from "@/lib/sentinelActivity"

const config = { ...CONFIG, deploymentBlock: 100, logBlockRange: 10 }

const REQUEST = requestId(7)
const OTHER_REQUEST = requestId(8)
const OTHER_ORACLE: Address = "0x9999999999999999999999999999999999999999"

const SENTINEL_A = getAddress(`0x${"a1".repeat(20)}`)
const SENTINEL_B = getAddress(`0x${"b2".repeat(20)}`)
const SENTINEL_C = getAddress(`0x${"c3".repeat(20)}`)

const SCOPE = { requestId: REQUEST, fromBlock: 100, toBlock: 125 }

type Position = {
  sentinel: Address
  blockNumber: number
  logIndex?: number
  id?: Hex
  address?: Address
}

function logAt(topics: Hex[], data: Hex, { blockNumber, logIndex = 0, address = config.oracleAddress }: Position): Log {
  return {
    address,
    topics,
    data,
    blockNumber,
    blockHash: requestId(blockNumber),
    transactionHash: keccak256(toHex(`${blockNumber}:${logIndex}:${address}:${topics.join()}:${data}`)),
    transactionIndex: 0,
    logIndex,
  }
}

function commitment(position: Position): Log {
  const topics = encodeEventTopics({
    abi: sentinelOracleAbi,
    eventName: "Committed",
    args: { requestId: position.id ?? REQUEST, sentinel: position.sentinel },
  }) as Hex[]
  return logAt(topics, encodeAbiParameters([{ type: "uint96" }], [10n]), position)
}

function reveal(position: Position, approved: boolean, reason: string): Log {
  const topics = encodeEventTopics({
    abi: sentinelOracleAbi,
    eventName: "Revealed",
    args: { requestId: position.id ?? REQUEST, sentinel: position.sentinel },
  }) as Hex[]
  const data = encodeAbiParameters([{ type: "bool" }, { type: "uint96" }, { type: "string" }], [approved, 10n, reason])
  return logAt(topics, data, position)
}

// What the reader must report for `log`, taken from the fixture log itself.
function activityOf(
  log: Log,
  sentinel: Address,
  action: SentinelActivity["action"],
  reason: string | null,
): SentinelActivity {
  return {
    sentinel,
    action,
    reason,
    transactionHash: log.transactionHash as Hex,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
  }
}

// Wraps a fixture RPC method, e.g. to fail it or to watch how it is called.
function wrapRpc<Args extends unknown[], Result>(
  mock: Mock<(...args: Args) => Promise<Result>>,
  wrapper: (original: (...args: Args) => Promise<Result>, ...args: Args) => Promise<Result>,
) {
  const original = mock.getMockImplementation()
  if (!original) throw new Error("The RPC mock has no implementation")
  mock.mockImplementation((...args) => wrapper(original, ...args))
}

// Rule codes and free text are the sentinels' own words, so the app has to show whatever they wrote.
const FREE_TEXT_REASON = "UNKNOWN_RULE_9: <b>%s</b>\n✗"

describe("fetchSentinelActivity", () => {
  it("returns every commitment and reveal of the request, oldest first, and nothing else", async () => {
    const commitB = commitment({ sentinel: SENTINEL_B, blockNumber: 105 })
    const commitA = commitment({ sentinel: SENTINEL_A, blockNumber: 105, logIndex: 2 })
    const commitC = commitment({ sentinel: SENTINEL_C, blockNumber: 106 })
    const approveA = reveal({ sentinel: SENTINEL_A, blockNumber: 112 }, true, "")
    const denyB = reveal({ sentinel: SENTINEL_B, blockNumber: 113, logIndex: 4 }, false, FREE_TEXT_REASON)
    const { sdk } = mockOracleSdk(
      [
        // Out of order, and mixed with events of another request and of another oracle.
        denyB,
        commitC,
        commitment({ sentinel: SENTINEL_A, blockNumber: 105, id: OTHER_REQUEST }),
        commitA,
        reveal({ sentinel: SENTINEL_A, blockNumber: 112, address: OTHER_ORACLE }, false, "elsewhere"),
        approveA,
        commitB,
      ],
      {},
    )

    const activity = await fetchSentinelActivity(sdk, config, SCOPE)

    expect(activity).toEqual([
      activityOf(commitB, SENTINEL_B, "committed", null),
      activityOf(commitA, SENTINEL_A, "committed", null),
      activityOf(commitC, SENTINEL_C, "committed", null),
      // A revealed approval without a reason stays distinguishable from a commitment.
      activityOf(approveA, SENTINEL_A, "approved", ""),
      // Rule codes and free text come back verbatim.
      activityOf(denyB, SENTINEL_B, "denied", FREE_TEXT_REASON),
    ])
  })

  it("keeps a commitment without reveal, and repeated commitments of one sentinel as separate events", async () => {
    const first = commitment({ sentinel: SENTINEL_A, blockNumber: 101 })
    const repeated = commitment({ sentinel: SENTINEL_A, blockNumber: 103 })
    const sameBlock = commitment({ sentinel: SENTINEL_A, blockNumber: 103, logIndex: 1 })
    const unrevealed = commitment({ sentinel: SENTINEL_B, blockNumber: 104 })
    const { sdk } = mockOracleSdk([unrevealed, sameBlock, repeated, first], {})

    const activity = await fetchSentinelActivity(sdk, config, SCOPE)

    expect(activity).toEqual([
      activityOf(first, SENTINEL_A, "committed", null),
      activityOf(repeated, SENTINEL_A, "committed", null),
      activityOf(sameBlock, SENTINEL_A, "committed", null),
      activityOf(unrevealed, SENTINEL_B, "committed", null),
    ])
  })

  it("returns an event the RPC reports twice only once", async () => {
    const vote = commitment({ sentinel: SENTINEL_A, blockNumber: 101 })
    const { sdk } = mockOracleSdk([vote, { ...vote }], {})

    await expect(fetchSentinelActivity(sdk, config, SCOPE)).resolves.toEqual([
      activityOf(vote, SENTINEL_A, "committed", null),
    ])
  })

  it("returns an empty list when no sentinel acted", async () => {
    const { sdk } = mockOracleSdk([disputeLog("DisputeTriggered", REQUEST, 110)], {})

    await expect(fetchSentinelActivity(sdk, config, SCOPE)).resolves.toEqual([])
  })

  it("searches the inclusive range one chunk at a time, through the freeze block and no further", async () => {
    const inRange = [100, 109, 110, 119, 120, 125].map((blockNumber) =>
      commitment({ sentinel: SENTINEL_A, blockNumber }),
    )
    const outside = [99, 126, 140].map((blockNumber) => commitment({ sentinel: SENTINEL_B, blockNumber }))
    const { sdk, getPastLogs } = mockOracleSdk([...outside, ...inRange], {})
    // Concurrent calls would all start before the first one finishes.
    const calls: string[] = []
    wrapRpc(getPastLogs, async (original, ...args) => {
      calls.push("start")
      const logs = await original(...args)
      calls.push("end")
      return logs
    })

    const activity = await fetchSentinelActivity(sdk, config, SCOPE)

    expect(activity.map(({ blockNumber }) => blockNumber)).toEqual([100, 109, 110, 119, 120, 125])
    expect(getPastLogs.mock.calls.map(([[filter]]) => [Number(filter.fromBlock), Number(filter.toBlock)])).toEqual([
      [100, 109],
      [110, 119],
      [120, 125],
    ])
    expect(calls).toEqual(["start", "end", "start", "end", "start", "end"])
  })

  it("searches a single block as one chunk", async () => {
    const vote = reveal({ sentinel: SENTINEL_A, blockNumber: 100 }, true, "ok")
    const { sdk, getPastLogs } = mockOracleSdk([vote], {})

    const activity = await fetchSentinelActivity(sdk, config, { requestId: REQUEST, fromBlock: 100, toBlock: 100 })

    expect(activity).toEqual([activityOf(vote, SENTINEL_A, "approved", "ok")])
    expect(getPastLogs).toHaveBeenCalledTimes(1)
  })

  it("fails without a partial result when a later chunk cannot be read", async () => {
    const early = commitment({ sentinel: SENTINEL_A, blockNumber: 101 })
    const late = reveal({ sentinel: SENTINEL_A, blockNumber: 121 }, true, "late")
    const { sdk, getPastLogs } = mockOracleSdk([early, late], {})
    wrapRpc(getPastLogs, async (original, ...args) => {
      if (Number(args[0][0].fromBlock) >= 110) throw new Error("RPC unavailable")
      return original(...args)
    })

    await expect(fetchSentinelActivity(sdk, config, SCOPE)).rejects.toThrow("RPC unavailable")
  })

  it("fails on a matching log it cannot decode", async () => {
    const undecodable = { ...commitment({ sentinel: SENTINEL_A, blockNumber: 101 }), data: "0x1234" as Hex }
    const { sdk } = mockOracleSdk([undecodable], {})

    await expect(fetchSentinelActivity(sdk, config, SCOPE)).rejects.toThrow()
  })

  it.each([
    ["a log of another request", commitment({ sentinel: SENTINEL_A, blockNumber: 101, id: OTHER_REQUEST })],
    ["a log of another contract", commitment({ sentinel: SENTINEL_A, blockNumber: 101, address: OTHER_ORACLE })],
    ["a log after the requested range", commitment({ sentinel: SENTINEL_A, blockNumber: 126 })],
    ["a log before the requested range", commitment({ sentinel: SENTINEL_A, blockNumber: 99 })],
    ["an event that is not a sentinel event", disputeLog("DisputeTriggered", REQUEST, 101)],
  ])("fails when the RPC ignores the filter and returns %s", async (_name, stray) => {
    const { sdk, getPastLogs } = mockOracleSdk([], {})
    getPastLogs.mockImplementation(async () => [commitment({ sentinel: SENTINEL_B, blockNumber: 102 }), stray])

    await expect(fetchSentinelActivity(sdk, config, SCOPE)).rejects.toThrow()
  })

  it.each([
    ["starts before the deployment block", { ...SCOPE, fromBlock: 99 }],
    ["is empty", { ...SCOPE, fromBlock: 121, toBlock: 120 }],
    ["has a fractional bound", { ...SCOPE, fromBlock: 100.5 }],
    ["has an unsafe bound", { ...SCOPE, toBlock: Number.MAX_SAFE_INTEGER + 1 }],
    ["has a bound that is not a number", { ...SCOPE, toBlock: Number.NaN }],
    ["has a request ID that is not a 32-byte hash", { ...SCOPE, requestId: "0x1234" as Hex }],
  ])("rejects a scope that %s without reading logs", async (_name, scope) => {
    const { sdk, getPastLogs } = mockOracleSdk([commitment({ sentinel: SENTINEL_A, blockNumber: 101 })], {})

    await expect(fetchSentinelActivity(sdk, config, scope)).rejects.toThrow()
    expect(getPastLogs).not.toHaveBeenCalled()
  })
})
