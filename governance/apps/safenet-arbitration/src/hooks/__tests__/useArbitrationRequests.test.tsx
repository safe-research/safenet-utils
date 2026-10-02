import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { CONFIG, disputeLog, mockOracleSdk, requestId, SAFE_INFO } from "@/__tests__/mock-sentinel-oracle"
import type { OracleConfig } from "@/config/oracle"
import { useArbitrationRequests } from "@/hooks/useArbitrationRequests"

const POLL_MS = 30_000

// Uses the hook's own query defaults (no test-wide `retry: false`), so a failed read only surfaces promptly if the hook
// itself doesn't retry it. A read of the chain head always happens first in a read, so counting those counts reads.
function setup(oracleConfig: OracleConfig = CONFIG) {
  const mock = mockOracleSdk([disputeLog("DisputeTriggered", requestId(1))], {
    [requestId(1)]: { state: RequestState.FROZEN },
  })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = renderHook(
    () => useArbitrationRequests(mock.sdk, { rpc: mock.sdk, key: "wallet" }, oracleConfig, SAFE_INFO.safeAddress, null),
    { wrapper },
  )
  return { ...mock, ...view, reads: () => mock.getBlockByNumber.mock.calls.length }
}

// Lets `ms` of fake time pass, settling every state update the elapsed timers cause.
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state)
  await act(async () => {
    // Bubbles, as in browsers, so the query client's `window` listener sees it too.
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe("useArbitrationRequests", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Unmount while fake timers are still installed, so the query clears the timers it created.
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("finishes historical discovery without exceeding the provider rate limit", async () => {
    const { result, getPastLogs } = setup({ ...CONFIG, logBlockRange: 10 })
    const read = getPastLogs.getMockImplementation()!
    let lastRead = -Infinity
    getPastLogs.mockImplementation(async (...args) => {
      if (Date.now() - lastRead < 300) throw new Error("RPC rate limit exceeded")
      lastRead = Date.now()
      return read(...args)
    })
    for (let step = 0; step < 12; step++) await elapse(500)
    expect(result.current.error).toBeNull()
    expect(result.current.data?.historyToBlock).toBeNull()
    expect(result.current.data?.requests.map(({ requestId: id }) => id)).toEqual([requestId(1)])
  })

  it("reads again every 30 seconds while the page is visible", async () => {
    const { result, reads } = setup()
    await elapse(0)
    expect(result.current.data?.requests).toHaveLength(1)
    const loaded = reads()

    await elapse(POLL_MS - 1)
    expect(reads()).toBe(loaded)
    await elapse(1)
    expect(reads()).toBeGreaterThan(loaded)
  })

  it("skips the reads while the page is hidden and reads straight away when it is visible again", async () => {
    const { reads } = setup()
    await elapse(0)
    await setVisibility("hidden")
    const hidden = reads()

    await elapse(4 * POLL_MS)
    expect(reads()).toBe(hidden)

    await setVisibility("visible")
    expect(reads()).toBeGreaterThan(hidden)
  })

  describe("after a failed read", () => {
    async function setupFailedPoll() {
      const mock = setup()
      await elapse(0)
      mock.getBlockByNumber.mockRejectedValueOnce(new Error("rpc unavailable"))
      await elapse(POLL_MS)
      // Flush the query observer's notification scheduled by the interval callback.
      await elapse(1)
      // The last successful read stays available, and nothing was retried behind the scenes.
      expect(mock.result.current.error).not.toBeNull()
      expect(mock.result.current.data?.requests).toHaveLength(1)
      return mock
    }

    it("stops polling until it is retried", async () => {
      const { result, reads } = await setupFailedPoll()
      const failed = reads()

      await elapse(4 * POLL_MS)
      expect(reads()).toBe(failed)

      await act(async () => {
        result.current.refresh()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.error).toBeNull()
      const recovered = reads()
      await elapse(POLL_MS)
      expect(reads()).toBeGreaterThan(recovered)
    })

    it("reads again when the page becomes visible", async () => {
      const { result } = await setupFailedPoll()

      await setVisibility("hidden")
      await setVisibility("visible")

      expect(result.current.error).toBeNull()
    })
  })
})
