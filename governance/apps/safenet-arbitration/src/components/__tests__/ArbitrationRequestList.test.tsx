import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { encodeRuling } from "@/lib/rulings"
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

  describe("request details", () => {
    it("shows the actions only for the expanded request", async () => {
      const { sdk } = mockOracleSdk(
        [disputeLog("DisputeTriggered", requestId(1)), disputeLog("DisputeTriggered", requestId(2))],
        {
          [requestId(1)]: { state: RequestState.FROZEN },
          [requestId(2)]: { state: RequestState.FROZEN },
        },
      )
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} />)
      const row = async (n: number) => (await screen.findByTitle(requestId(n))).closest("tr")!
      // Details are rendered in the row directly below the request's own row.
      const detailsOf = async (n: number) => (await row(n)).nextElementSibling as HTMLElement | null

      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()

      fireEvent.click(await row(2))
      expect((await row(2)).getAttribute("aria-expanded")).toBe("true")
      expect(within((await detailsOf(2))!).getByRole("button", { name: "Approve" })).toBeDefined()

      // Expanding another request collapses the first.
      fireEvent.click(await row(1))
      expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1)
      expect(within((await detailsOf(1))!).getByRole("button", { name: "Approve" })).toBeDefined()
      expect((await row(2)).getAttribute("aria-expanded")).toBe("false")

      fireEvent.click(await row(1))
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    })

    it("toggles from the keyboard", async () => {
      const { sdk } = mockOracleSdk([disputeLog("DisputeTriggered", requestId(1))], {
        [requestId(1)]: { state: RequestState.FROZEN },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} />)
      const row = (await screen.findByTitle(requestId(1))).closest("tr")!

      fireEvent.keyDown(row, { key: "Enter" })
      expect(screen.getByRole("button", { name: "Approve" })).toBeDefined()
      fireEvent.keyDown(row, { key: " " })
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    })
  })

  describe("rulings", () => {
    async function renderFrozenRequest() {
      const mock = mockOracleSdk([disputeLog("DisputeTriggered", requestId(0xabc))], {
        [requestId(0xabc)]: { state: RequestState.FROZEN },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={mock.sdk} config={CONFIG} />)
      fireEvent.click(await screen.findByTitle(requestId(0xabc)))
      return mock
    }

    function enterRationale(text: string) {
      fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), { target: { value: text } })
    }

    it.each([
      ["Approve", "approve"],
      ["Deny", "deny"],
      ["Decline", "outOfScope"],
    ] as const)("queues a %s ruling with its rationale", async (label, ruling) => {
      const { send } = await renderFrozenRequest()

      fireEvent.click(screen.getByRole("button", { name: label }))
      expect(screen.getByRole("heading", { name: `${label} ruling` })).toBeDefined()
      enterRationale("  Sentinels were right.  ")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      expect(send).toHaveBeenCalledWith({
        txs: [
          {
            to: CONFIG.oracleAddress,
            value: "0",
            data: encodeRuling(requestId(0xabc), ruling, "Sentinels were right."),
          },
        ],
      })
    })

    it("requires a rationale", async () => {
      await renderFrozenRequest()

      fireEvent.click(screen.getByRole("button", { name: "Approve" }))
      const submit = screen.getByRole("button", { name: "Submit to Safe" }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      enterRationale("   ")
      expect(submit.disabled).toBe(true)
      enterRationale("ok")
      expect(submit.disabled).toBe(false)
    })

    it("shows a rejected proposal and allows retrying", async () => {
      const { send } = await renderFrozenRequest()
      send.mockRejectedValueOnce(new Error("Transaction was rejected"))

      fireEvent.click(screen.getByRole("button", { name: "Deny" }))
      enterRationale("no")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText("Failed to submit ruling: Transaction was rejected")).toBeDefined()
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
    })

    it("closes the form on cancel", async () => {
      const { send } = await renderFrozenRequest()

      fireEvent.click(screen.getByRole("button", { name: "Approve" }))
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

      expect(screen.queryByLabelText("Rationale (recorded on-chain)")).toBeNull()
      expect(send).not.toHaveBeenCalled()
    })
  })
})
