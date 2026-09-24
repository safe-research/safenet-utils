import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { CONFIG, disputeLog, mockOracleSdk, requestId } from "@/__tests__/mock-sentinel-oracle"
import { renderWithQueryClient } from "@/__tests__/render"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"

const PAGED_CONFIG = { ...CONFIG, logBlockRange: 100 }

describe("ArbitrationRequestList", () => {
  afterEach(cleanup)

  it("lists requests awaiting arbitration", async () => {
    const { sdk } = mockOracleSdk([disputeLog("DisputeTriggered", requestId(0xabc))], {
      [requestId(0xabc)]: {
        state: RequestState.FROZEN,
        sponsor: "0x2222222222222222222222222222222222222222",
        approve: 3,
        deny: 2,
        deadline: 123n,
      },
    })

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} />)

    expect(screen.getByText("Loading arbitration requests…")).toBeDefined()
    const row = (await screen.findByTitle(requestId(0xabc))).closest("tr")!
    expect(row.textContent).toContain("0x2222…2222")
    expect(row.textContent).toContain("3 / 2")
    expect(row.textContent).toContain("block 123")
  })

  it("shows an empty state", async () => {
    const { sdk } = mockOracleSdk([], {})

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} />)

    expect(await screen.findByText("No requests are awaiting arbitration in the searched blocks.")).toBeDefined()
  })

  it("shows errors and recovers on refresh", async () => {
    const { sdk, getPastLogs } = mockOracleSdk([], {})
    getPastLogs.mockRejectedValueOnce(new Error("rpc unavailable"))

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} />)

    expect(await screen.findByText("Failed to load arbitration requests: rpc unavailable")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("No requests are awaiting arbitration in the searched blocks.")).toBeDefined()
  })

  it("loads older blocks on demand", async () => {
    const { sdk } = mockOracleSdk(
      [disputeLog("DisputeTriggered", requestId(1), 850), disputeLog("DisputeTriggered", requestId(2), 950)],
      {
        [requestId(1)]: { state: RequestState.FROZEN },
        [requestId(2)]: { state: RequestState.FROZEN },
      },
      1000,
    )

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={PAGED_CONFIG} />)

    expect(await screen.findByTitle(requestId(2))).toBeDefined()
    expect(screen.queryByTitle(requestId(1))).toBeNull()
    expect(screen.getByText("Searched back to block 901")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Load older" }))
    expect(await screen.findByText("Searched back to block 801")).toBeDefined()
    // Newest first: the older page's request is appended below.
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows.map((row) => row.querySelector("td")?.title)).toEqual([requestId(2), requestId(1)])
  })

  it("stops offering older blocks at genesis", async () => {
    const { sdk } = mockOracleSdk([], {}, 50)

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={PAGED_CONFIG} />)

    expect(await screen.findByText("Searched back to block 0")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull()
  })
})
