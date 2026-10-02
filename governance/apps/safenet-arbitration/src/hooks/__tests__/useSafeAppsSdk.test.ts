import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSafeAppsSdk } from "@/hooks/useSafeAppsSdk"

const SAFE_INFO: SafeInfo = {
  safeAddress: "0x1111111111111111111111111111111111111111",
  chainId: 100,
  threshold: 2,
  owners: ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"],
  isReadOnly: false,
}

const OTHER_SAFE_INFO: SafeInfo = {
  ...SAFE_INFO,
  safeAddress: "0x4444444444444444444444444444444444444444",
  chainId: 1,
}

const REFRESH_MS = 30_000

function mockSdk(getInfo: () => Promise<SafeInfo>): SafeAppsSDK {
  return { safe: { getInfo: vi.fn(getInfo) } } as unknown as SafeAppsSDK
}

function simulateIframe() {
  vi.spyOn(window, "parent", "get").mockReturnValue({} as Window)
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
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe("useSafeAppsSdk", () => {
  afterEach(() => {
    // Unmount while fake timers are still installed, so the hook clears the timers it created.
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("reports the connected Safe when running inside Safe{Wallet}", async () => {
    simulateIframe()
    const sdk = mockSdk(async () => SAFE_INFO)

    const { result } = renderHook(() => useSafeAppsSdk(sdk))

    expect(result.current.connection).toEqual({ status: "connecting" })
    await waitFor(() => expect(result.current.connection).toEqual({ status: "connected", safe: SAFE_INFO }))
    expect(result.current.sdk).toBe(sdk)
  })

  it("reports unavailable when not framed", async () => {
    const sdk = mockSdk(async () => SAFE_INFO)

    const { result } = renderHook(() => useSafeAppsSdk(sdk))

    await waitFor(() => expect(result.current.connection).toEqual({ status: "unavailable" }))
  })

  it("reports unavailable when the parent frame never answers", async () => {
    simulateIframe()
    const sdk = mockSdk(() => new Promise(() => {}))

    const { result } = renderHook(() => useSafeAppsSdk(sdk, 10))

    await waitFor(() => expect(result.current.connection).toEqual({ status: "unavailable" }))
  })

  it("reports unavailable when the Safe info request fails", async () => {
    simulateIframe()
    const sdk = mockSdk(async () => {
      throw new Error("boom")
    })

    const { result } = renderHook(() => useSafeAppsSdk(sdk))

    await waitFor(() => expect(result.current.connection).toEqual({ status: "unavailable" }))
  })

  describe("while the page stays open", () => {
    function setup(timeoutMs?: number) {
      vi.useFakeTimers()
      simulateIframe()
      const getInfo = vi.fn<() => Promise<SafeInfo>>().mockResolvedValue(SAFE_INFO)
      const sdk = mockSdk(getInfo)
      const hook = renderHook(() => useSafeAppsSdk(sdk, timeoutMs))
      return { ...hook, getInfo }
    }

    it("follows the connected Safe as it changes, without replacing an unchanged one", async () => {
      const { result, getInfo } = setup()
      await elapse(0)
      const connected = result.current.connection
      expect(connected).toEqual({ status: "connected", safe: SAFE_INFO })

      getInfo.mockResolvedValue({ ...SAFE_INFO })
      await elapse(REFRESH_MS)
      expect(result.current.connection).toBe(connected)

      getInfo.mockResolvedValue({ ...SAFE_INFO, isReadOnly: true })
      await elapse(REFRESH_MS)
      expect(result.current.connection).toEqual({ status: "connected", safe: { ...SAFE_INFO, isReadOnly: true } })

      getInfo.mockResolvedValue(OTHER_SAFE_INFO)
      await elapse(REFRESH_MS)
      expect(result.current.connection).toEqual({ status: "connected", safe: OTHER_SAFE_INFO })
    })

    it("drops the Safe when a refresh fails and recovers when the next one succeeds", async () => {
      const { result, getInfo } = setup()
      await elapse(0)
      expect(result.current.connection.status).toBe("connected")

      getInfo.mockRejectedValue(new Error("boom"))
      await elapse(REFRESH_MS)
      expect(result.current.connection).toEqual({ status: "unavailable" })

      getInfo.mockResolvedValue(SAFE_INFO)
      await elapse(REFRESH_MS)
      expect(result.current.connection).toEqual({ status: "connected", safe: SAFE_INFO })
    })

    it("drops the Safe when a refresh goes unanswered", async () => {
      const { result, getInfo } = setup(1000)
      await elapse(0)
      expect(result.current.connection.status).toBe("connected")

      getInfo.mockReturnValue(new Promise(() => {}))
      await elapse(REFRESH_MS + 1000)

      expect(result.current.connection).toEqual({ status: "unavailable" })
    })

    it("checks only while visible and straight away when the page becomes visible", async () => {
      const { result, getInfo } = setup()
      await elapse(0)
      await setVisibility("hidden")
      const callsWhenHidden = getInfo.mock.calls.length

      await elapse(4 * REFRESH_MS)
      expect(getInfo).toHaveBeenCalledTimes(callsWhenHidden)

      getInfo.mockResolvedValue(OTHER_SAFE_INFO)
      await setVisibility("visible")
      expect(result.current.connection).toEqual({ status: "connected", safe: OTHER_SAFE_INFO })

      await elapse(REFRESH_MS)
      expect(getInfo).toHaveBeenCalledTimes(callsWhenHidden + 2)
    })

    it("never runs two checks at once", async () => {
      vi.useFakeTimers()
      simulateIframe()
      let answer: (safe: SafeInfo) => void = () => {}
      const getInfo = vi.fn(() => new Promise<SafeInfo>((resolve) => (answer = resolve)))
      const sdk = mockSdk(getInfo)
      const { result } = renderHook(() => useSafeAppsSdk(sdk, 10 * REFRESH_MS))

      await elapse(3 * REFRESH_MS)
      await setVisibility("hidden")
      await setVisibility("visible")
      expect(getInfo).toHaveBeenCalledTimes(1)

      answer(SAFE_INFO)
      await elapse(0)
      expect(result.current.connection).toEqual({ status: "connected", safe: SAFE_INFO })
      await elapse(REFRESH_MS)
      expect(getInfo).toHaveBeenCalledTimes(2)
    })

    it("stops checking and leaves no timers behind once unmounted", async () => {
      vi.useFakeTimers()
      simulateIframe()
      let answer: (safe: SafeInfo) => void = () => {}
      const getInfo = vi.fn(() => new Promise<SafeInfo>((resolve) => (answer = resolve)))
      const sdk = mockSdk(getInfo)
      const { unmount } = renderHook(() => useSafeAppsSdk(sdk, 10 * REFRESH_MS))

      unmount()
      await act(async () => {
        answer(SAFE_INFO)
        await vi.advanceTimersByTimeAsync(0)
      })
      await elapse(2 * REFRESH_MS)
      await setVisibility("visible")

      expect(getInfo).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
