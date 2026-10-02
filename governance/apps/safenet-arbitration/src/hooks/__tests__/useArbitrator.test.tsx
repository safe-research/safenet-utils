import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { CONFIG, mockOracleSdk, SAFE_INFO } from "@/__tests__/mock-sentinel-oracle"
import { useArbitrator } from "@/hooks/useArbitrator"

const OTHER_SAFE: SafeInfo = { ...SAFE_INFO, safeAddress: `0x${"ab".repeat(20)}` }

// Uses the hook's own query defaults (no test-wide `retry: false`), so a failed read is only reported promptly if the
// hook itself doesn't retry it.
function renderArbitrator(sdk: SafeAppsSDK, initialSafe: SafeInfo | undefined) {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(({ safe }) => useArbitrator(sdk, CONFIG, safe), { wrapper, initialProps: { safe: initialSafe } })
}

describe("useArbitrator", () => {
  afterEach(cleanup)

  it("reads the oracle's arbitrator for a Safe on the configured chain", async () => {
    const { sdk } = mockOracleSdk([], {})

    const { result } = renderArbitrator(sdk, SAFE_INFO)

    await waitFor(() => expect(result.current.data).toBe(SAFE_INFO.safeAddress))
  })

  it("reads nothing without a Safe on the configured chain", async () => {
    const { sdk, call } = mockOracleSdk([], {})

    const { result, rerender } = renderArbitrator(sdk, undefined)
    rerender({ safe: { ...SAFE_INFO, chainId: CONFIG.chainId + 1 } })

    expect(result.current.fetchStatus).toBe("idle")
    expect(result.current.data).toBeUndefined()
    expect(call).not.toHaveBeenCalled()
  })

  it("reads again for a different Safe but keeps the answer for one it has already read", async () => {
    const { sdk, call } = mockOracleSdk([], {})
    const { result, rerender } = renderArbitrator(sdk, SAFE_INFO)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ safe: OTHER_SAFE })
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(call).toHaveBeenCalledTimes(2)

    rerender({ safe: SAFE_INFO })
    expect(result.current.data).toBe(SAFE_INFO.safeAddress)
    rerender({ safe: { ...OTHER_SAFE, safeAddress: `0x${"AB".repeat(20)}` } })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("reports a failed read once and reads again only when asked to", async () => {
    const { sdk, call } = mockOracleSdk([], {})
    call.mockRejectedValueOnce(new Error("rpc unavailable"))
    const { result } = renderArbitrator(sdk, SAFE_INFO)

    await waitFor(() => expect(result.current.error?.message).toBe("rpc unavailable"))
    expect(call).toHaveBeenCalledTimes(1)

    await result.current.refetch()
    await waitFor(() => expect(result.current.data).toBe(SAFE_INFO.safeAddress))
    expect(call).toHaveBeenCalledTimes(2)
  })
})
