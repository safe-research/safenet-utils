import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSafeAppsSdk } from "@/hooks/useSafeAppsSdk"

const SAFE_INFO: SafeInfo = {
  safeAddress: "0x1111111111111111111111111111111111111111",
  chainId: 100,
  threshold: 2,
  owners: ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"],
  isReadOnly: false,
}

function mockSdk(getInfo: () => Promise<SafeInfo>): SafeAppsSDK {
  return { safe: { getInfo: vi.fn(getInfo) } } as unknown as SafeAppsSDK
}

function simulateIframe() {
  vi.spyOn(window, "parent", "get").mockReturnValue({} as Window)
}

describe("useSafeAppsSdk", () => {
  afterEach(() => {
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
})
