import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchSentinelLabels } from "@/lib/sentinelInfo"

const URL = "https://example.com/sentinel-info.json"

function mockFetch(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

describe("fetchSentinelLabels", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps checksummed sentinel addresses to their labels", async () => {
    const fetch = mockFetch([
      { address: "0x6D081448c04d9ef7cf8EcF54207B1931ecc25312", is_active: true, label: "Candide" },
      // Lowercase addresses are matched too.
      { address: "0xc84a0928632382e75c543acced101b9525027362", label: " BlockSec " },
    ])

    const labels = await fetchSentinelLabels(URL)

    expect(fetch).toHaveBeenCalledWith(URL)
    expect(Object.fromEntries(labels)).toEqual({
      "0x6D081448c04d9ef7cf8EcF54207B1931ecc25312": "Candide",
      "0xc84a0928632382E75c543ACCeD101B9525027362": "BlockSec",
    })
  })

  it("skips malformed entries", async () => {
    mockFetch([
      { address: "0x1234", label: "Short" },
      { address: "0x6D081448c04d9ef7cf8EcF54207B1931ecc25312" },
      { address: "0x6D081448c04d9ef7cf8EcF54207B1931ecc25312", label: "" },
      "not an object",
      { address: "0xb28eb357BFA420C17Bae3E6BfDB50094Fb5BabF2", label: "IntentGuard" },
    ])

    expect(Object.fromEntries(await fetchSentinelLabels(URL))).toEqual({
      "0xb28eb357BFA420C17Bae3E6BfDB50094Fb5BabF2": "IntentGuard",
    })
  })

  it("rejects a failed response or a non-list body", async () => {
    mockFetch([], 404)
    await expect(fetchSentinelLabels(URL)).rejects.toThrow("HTTP 404")
    mockFetch({ sentinels: [] })
    await expect(fetchSentinelLabels(URL)).rejects.toThrow()
  })
})
