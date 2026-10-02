import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo, SendTransactionsResponse } from "@safe-global/safe-apps-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { decodeFunctionData, encodeEventTopics, type Hex } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RULING_LABELS, RULINGS, type Ruling } from "@/lib/rulings"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import {
  arbitrationCase,
  CHAIN_INFO,
  CONFIG,
  disputeLog,
  mockOracleSdk,
  type RequestFixture,
  requestId,
  SAFE_INFO,
  SAFE_TRANSACTION,
} from "@/__tests__/mock-sentinel-oracle"
import { renderWithQueryClient } from "@/__tests__/render"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"
import { RulingForm } from "@/components/RulingForm"

// Reaching the deployment block from a head at block 150 takes six log pages of ten blocks.
const RANGED_CONFIG = { ...CONFIG, deploymentBlock: 100, logBlockRange: 10 }

const FROZEN: RequestFixture = { state: RequestState.FROZEN }

// What the mocked Safe{Wallet} returns for a queued proposal.
const QUEUED_HASH = `0x${"cd".repeat(32)}`

const triggered = (n: number, blockNumber = 1) => disputeLog("DisputeTriggered", requestId(n), blockNumber)

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type LogSearch = [[{ fromBlock: number | string; toBlock: number | string }]]

// How many of the recorded log searches covered each block.
function searchCounts(searches: LogSearch[]) {
  const counts = new Map<number, number>()
  for (const [[filter]] of searches) {
    for (let block = Number(filter.fromBlock); block <= Number(filter.toBlock); block++) {
      counts.set(block, (counts.get(block) ?? 0) + 1)
    }
  }
  return counts
}

// The request IDs of the listed rows, top to bottom. Only meaningful while no row is expanded.
function listedIds() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("td")?.title)
}

async function refresh() {
  const button = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

function rulingButton(ruling: Ruling) {
  return screen.getByRole("button", { name: RULING_LABELS[ruling] }) as HTMLButtonElement
}

// The form for a ruling, named after it.
function rulingForm(ruling: Ruling) {
  return screen.getByRole("form", { name: RULING_LABELS[ruling] })
}

function enterRationale(text: string) {
  fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), { target: { value: text } })
}

// Lets work started by an event, e.g. an unwanted proposal, reach the SDK before asserting on its absence.
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  })
}

async function waitForEvidence() {
  await waitFor(() => expect(rulingButton("approve").disabled).toBe(false))
}

// The list's own Retry, as opposed to any retry offered inside an expanded request.
function retryRead() {
  const failure = screen.getByRole("alert", { name: "Arbitration requests could not be read" })
  fireEvent.click(within(failure).getByRole("button", { name: "Retry" }))
}

async function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state)
  await act(async () => {
    // Bubbles, as in browsers, so the query client's `window` listener sees it too.
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
  })
}

describe("ArbitrationRequestList", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

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

    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)

    expect(screen.getByText("Loading arbitration requests…")).toBeDefined()
    const row = (await screen.findByTitle(requestId(0xabc))).closest("tr")!
    expect(row.textContent).toContain("0x2222…2222")
    expect(row.textContent).toContain("3 / 2")
    expect(row.textContent).toContain("block 123")
    expect(screen.getByText("Checked through block 100")).toBeDefined()
  })

  describe("searching the oracle's history", () => {
    it("withholds the empty state until every block has been searched", async () => {
      const { sdk, getPastLogs } = mockOracleSdk([], {}, 150)
      const release = deferred()
      const search = getPastLogs.getMockImplementation()!
      getPastLogs.mockImplementation(async (...args: Parameters<typeof search>) => {
        // The newest page is searched straight away; every older one waits.
        if (getPastLogs.mock.calls.length > 1) await release.promise
        return search(...args)
      })

      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={RANGED_CONFIG} safe={SAFE_INFO} />)

      expect(await screen.findByText(/Partial result/)).toBeDefined()
      expect(screen.getByText(/Blocks not searched yet: 100–140\./)).toBeDefined()
      expect(screen.getByText("Checked through block 150")).toBeDefined()
      expect(screen.queryByText("No requests are awaiting arbitration.")).toBeNull()

      release.resolve()
      expect(await screen.findByText("No requests are awaiting arbitration.", {}, { timeout: 3000 })).toBeDefined()
      expect(screen.queryByText(/Partial result/)).toBeNull()
    })

    it("finds requests behind empty recent pages, down to the deployment block", async () => {
      const { sdk, getPastLogs } = mockOracleSdk(
        [triggered(1, 100), triggered(2, 110)],
        { [requestId(1)]: FROZEN, [requestId(2)]: FROZEN },
        150,
      )

      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={RANGED_CONFIG} safe={SAFE_INFO} />)

      // The request triggered exactly at the deployment block is the last one reached.
      await screen.findByTitle(requestId(1), {}, { timeout: 3000 })
      await waitFor(() => expect(screen.queryByText(/Partial result/)).toBeNull())
      expect(listedIds()).toEqual([requestId(2), requestId(1)])
      const counts = searchCounts(getPastLogs.mock.calls)
      expect(Math.min(...counts.keys())).toBe(100)
      expect(Math.max(...counts.keys())).toBe(150)
      expect(counts.size).toBe(51)
      expect(Math.max(...counts.values())).toBe(1)
    })

    it("repeats a failed page on retry rather than skipping its requests", async () => {
      const { sdk, getPastLogs } = mockOracleSdk([triggered(1, 105)], { [requestId(1)]: FROZEN }, 150)
      const search = getPastLogs.getMockImplementation()!
      let failing = true
      getPastLogs.mockImplementation(async (...args: Parameters<typeof search>) => {
        const [filter] = args[0]
        if (failing && Number(filter.fromBlock) <= 105 && Number(filter.toBlock) >= 105) {
          throw new Error("rpc unavailable")
        }
        return search(...args)
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={RANGED_CONFIG} safe={SAFE_INFO} />)

      expect(
        await screen.findByText("Failed to load arbitration requests: rpc unavailable", {}, { timeout: 3000 }),
      ).toBeDefined()
      expect(screen.queryByTitle(requestId(1))).toBeNull()
      expect(screen.queryByText("No requests are awaiting arbitration.")).toBeNull()

      failing = false
      retryRead()

      expect(await screen.findByTitle(requestId(1))).toBeDefined()
      await waitFor(() => expect(screen.queryByText(/Partial result/)).toBeNull())
      expect(screen.queryByText(/Failed to load/)).toBeNull()
    })

    it("recovers from a failed first load", async () => {
      const { sdk, getPastLogs } = mockOracleSdk([], {})
      getPastLogs.mockRejectedValueOnce(new Error("rpc unavailable"))

      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)

      expect(await screen.findByText("Failed to load arbitration requests: rpc unavailable")).toBeDefined()
      expect(screen.queryByText(/Showing the last successful read/)).toBeNull()
      retryRead()
      expect(await screen.findByText("No requests are awaiting arbitration.")).toBeDefined()
      expect(screen.queryByText(/Failed to load/)).toBeNull()
    })

    it("pauses while the page is hidden and resumes when it is visible again", async () => {
      vi.useFakeTimers()
      try {
        const { sdk, getPastLogs } = mockOracleSdk([triggered(1, 105)], { [requestId(1)]: FROZEN }, 150)
        await setVisibility("hidden")
        renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={RANGED_CONFIG} safe={SAFE_INFO} />)
        await act(() => vi.advanceTimersByTimeAsync(1))
        expect(screen.getByText(/Partial result/)).toBeDefined()
        await act(() => vi.advanceTimersByTimeAsync(60_000))
        expect(getPastLogs).toHaveBeenCalledTimes(1)

        await setVisibility("visible")
        for (let step = 0; step < 6; step++) await act(() => vi.advanceTimersByTimeAsync(500))
        expect(screen.getByTitle(requestId(1))).toBeDefined()
        expect(screen.queryByText(/Partial result/)).toBeNull()
      } finally {
        cleanup()
        vi.useRealTimers()
      }
    })
  })

  describe("refreshing", () => {
    it("shows a newly disputed request first, with one row per request", async () => {
      // Providers can repeat a log, e.g. across overlapping queries.
      const first = triggered(1, 10)
      const logs = [first, first]
      const requests: Record<Hex, RequestFixture> = { [requestId(1)]: FROZEN }
      const { sdk, head, getPastLogs } = mockOracleSdk(logs, requests)
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      await screen.findByTitle(requestId(1))
      expect(listedIds()).toEqual([requestId(1)])

      head.number = 120
      logs.push(triggered(2, 110))
      requests[requestId(2)] = FROZEN
      getPastLogs.mockClear()
      await refresh()

      await screen.findByTitle(requestId(2))
      expect(listedIds()).toEqual([requestId(2), requestId(1)])
      // Only the blocks mined since the previous read were searched.
      const counts = searchCounts(getPastLogs.mock.calls)
      expect(Math.min(...counts.keys())).toBe(101)
      expect(Math.max(...counts.keys())).toBe(120)
      expect(Math.max(...counts.values())).toBe(1)
    })

    it.each([
      ["resolved as approved", RequestState.RESOLVED_APPROVED],
      ["resolved as denied", RequestState.RESOLVED_DENIED],
      ["timed out", RequestState.TIMED_OUT],
    ] as const)("drops a request that was %s, without needing its settlement log", async (_label, state) => {
      const requests: Record<Hex, RequestFixture> = { [requestId(1)]: FROZEN, [requestId(2)]: FROZEN }
      const { sdk, head } = mockOracleSdk([triggered(1, 10), triggered(2, 20)], requests)
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      await screen.findByTitle(requestId(1))

      head.number = 101
      requests[requestId(1)] = { state }
      await refresh()

      await waitFor(() => expect(screen.queryByTitle(requestId(1))).toBeNull())
      expect(listedIds()).toEqual([requestId(2)])
    })

    it("offers the timeout only after the deadline block, while the request stays open to rulings", async () => {
      const { sdk, head } = mockOracleSdk([triggered(1)], {
        [requestId(1)]: { state: RequestState.FROZEN, deadline: 100n },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      await screen.findByTitle(requestId(1))
      expect(screen.queryByText("Timeout available")).toBeNull()

      head.number = 101
      await refresh()

      expect(await screen.findByText("Timeout available")).toBeDefined()
      fireEvent.click(screen.getByTitle(requestId(1)))
      const outOfScope = screen.getByRole("button", { name: RULING_LABELS.outOfScope }) as HTMLButtonElement
      expect(outOfScope.disabled).toBe(false)
    })

    it("keeps the last read visible but withholds rulings when a refresh fails", async () => {
      const { sdk, head, getPastLogs } = mockOracleSdk([triggered(1)], { [requestId(1)]: FROZEN })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      await screen.findByTitle(requestId(1))

      head.number = 101
      getPastLogs.mockRejectedValueOnce(new Error("rpc unavailable"))
      await refresh()

      expect(await screen.findByText("Failed to load arbitration requests: rpc unavailable")).toBeDefined()
      expect(screen.getByText(/Showing the last successful read, at block 100/)).toBeDefined()
      expect(screen.getByText("Checked through block 100")).toBeDefined()
      fireEvent.click(screen.getByTitle(requestId(1)))
      const outOfScope = () => screen.getByRole("button", { name: RULING_LABELS.outOfScope }) as HTMLButtonElement
      expect(outOfScope().disabled).toBe(true)

      retryRead()

      await waitFor(() => expect(screen.queryByText(/Failed to load/)).toBeNull())
      expect(screen.getByText("Checked through block 101")).toBeDefined()
      expect(outOfScope().disabled).toBe(false)
    })

    it("resets an open ruling form when the chain history under the list was replaced", async () => {
      const { sdk, head, blockHashes } = mockOracleSdk([triggered(1)], { [requestId(1)]: FROZEN })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      fireEvent.click(await screen.findByTitle(requestId(1)))
      fireEvent.click(screen.getByRole("button", { name: RULING_LABELS.outOfScope }))
      expect(screen.getByLabelText("Rationale (recorded on-chain)")).toBeDefined()

      // Another block took the place of the one the list was read at.
      blockHashes.set(head.number, requestId(0xbeef))
      await refresh()

      await waitFor(() => expect(screen.queryByLabelText("Rationale (recorded on-chain)")).toBeNull())
      expect(screen.getByTitle(requestId(1)).closest("tr")!.getAttribute("aria-expanded")).toBe("true")
    })

    it("ignores a late answer that was requested for another Safe", async () => {
      const otherSafe: SafeInfo = { ...SAFE_INFO, safeAddress: "0x3333333333333333333333333333333333333333" }
      const previous = mockOracleSdk([triggered(1)], { [requestId(1)]: FROZEN })
      const lateHead = deferred()
      const readHead = previous.getBlockByNumber.getMockImplementation()!
      previous.getBlockByNumber.mockImplementationOnce(async (...args: Parameters<typeof readHead>) => {
        await lateHead.promise
        return readHead(...args)
      })
      const current = mockOracleSdk([triggered(2)], { [requestId(2)]: FROZEN })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const list = (sdk: SafeAppsSDK, safe: SafeInfo) => (
        <QueryClientProvider client={client}>
          <ArbitrationRequestList sdk={sdk} config={CONFIG} safe={safe} />
        </QueryClientProvider>
      )
      const { rerender } = render(list(previous.sdk, SAFE_INFO))
      rerender(list(current.sdk, otherSafe))
      await screen.findByTitle(requestId(2))

      lateHead.resolve()
      await act(async () => {
        // Lets the late answer arrive before asserting on its absence.
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      })

      expect(listedIds()).toEqual([requestId(2)])
    })
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
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      const row = async (n: number) => (await screen.findByTitle(requestId(n))).closest("tr")!
      // Details are rendered in the row directly below the request's own row.
      const detailsOf = async (n: number) => (await row(n)).nextElementSibling as HTMLElement | null

      expect(screen.queryByRole("button", { name: RULING_LABELS.approve })).toBeNull()

      fireEvent.click(await row(2))
      expect((await row(2)).getAttribute("aria-expanded")).toBe("true")
      expect(within((await detailsOf(2))!).getByRole("button", { name: RULING_LABELS.approve })).toBeDefined()

      // Expanding another request collapses the first.
      fireEvent.click(await row(1))
      expect(screen.getAllByRole("button", { name: RULING_LABELS.approve })).toHaveLength(1)
      expect(within((await detailsOf(1))!).getByRole("button", { name: RULING_LABELS.approve })).toBeDefined()
      expect((await row(2)).getAttribute("aria-expanded")).toBe("false")

      fireEvent.click(await row(1))
      expect(screen.queryByRole("button", { name: RULING_LABELS.approve })).toBeNull()
    })

    it("toggles from the keyboard", async () => {
      const { sdk } = mockOracleSdk([disputeLog("DisputeTriggered", requestId(1))], {
        [requestId(1)]: { state: RequestState.FROZEN },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      const row = (await screen.findByTitle(requestId(1))).closest("tr")!

      fireEvent.keyDown(row, { key: "Enter" })
      expect(screen.getByRole("button", { name: RULING_LABELS.approve })).toBeDefined()
      fireEvent.keyDown(row, { key: " " })
      expect(screen.queryByRole("button", { name: RULING_LABELS.approve })).toBeNull()
    })
  })

  describe("proposed transaction", () => {
    function details() {
      return within(screen.getByRole("region", { name: "Proposed transaction" }))
    }

    it("shows the transaction the request was posted for", async () => {
      const { id, logs, request } = arbitrationCase()
      const { sdk } = mockOracleSdk(logs, { [id]: request })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)

      fireEvent.click(await screen.findByTitle(id))

      expect(await screen.findByText(SAFE_TRANSACTION.safe)).toBeDefined()
      expect(details().getByText(SAFE_TRANSACTION.to)).toBeDefined()
      expect(details().getByText("1234 wei")).toBeDefined()
      expect(details().getByText("DelegateCall")).toBeDefined()
      expect(details().getByText("0xdeadbeef")).toBeDefined()
      expect(details().getByText("42")).toBeDefined()
    })

    it("says so when no matching proposal is found, but still allows an out-of-scope ruling", async () => {
      const { sdk, send } = mockOracleSdk([disputeLog("DisputeTriggered", requestId(1))], {
        [requestId(1)]: { state: RequestState.FROZEN },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)

      fireEvent.click(await screen.findByTitle(requestId(1)))

      expect(await screen.findByText("No proposal matching this request was found.")).toBeDefined()
      expect(rulingButton("approve").disabled).toBe(true)
      expect(rulingButton("deny").disabled).toBe(true)
      expect(rulingButton("outOfScope").disabled).toBe(false)

      fireEvent.click(rulingButton("outOfScope"))
      enterRationale("No matching proposal was found.")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      const transaction = send.mock.calls[0][0].txs[0]
      expect(decodeFunctionData({ abi: sentinelOracleAbi, data: transaction.data as Hex })).toEqual({
        functionName: "markOutOfScope",
        args: [requestId(1), "No matching proposal was found."],
      })
    })

    it("shows errors loading the proposal", async () => {
      const { sdk, getPastLogs } = mockOracleSdk([disputeLog("DisputeTriggered", requestId(1))], {
        [requestId(1)]: { state: RequestState.FROZEN },
      })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      await screen.findByTitle(requestId(1))
      getPastLogs.mockRejectedValueOnce(new Error("rpc unavailable"))

      fireEvent.click(screen.getByTitle(requestId(1)))

      expect(await screen.findByText("Failed to load proposed transaction: rpc unavailable")).toBeDefined()
      expect((screen.getByRole("button", { name: RULING_LABELS.approve }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole("button", { name: RULING_LABELS.outOfScope }) as HTMLButtonElement).disabled).toBe(false)
    })

    it("blocks incomplete sentinel evidence and restores security rulings after Retry", async () => {
      const { id, logs, request } = arbitrationCase()
      const revealTopic = encodeEventTopics({ abi: sentinelOracleAbi, eventName: "Revealed" })[0]
      const index = logs.findIndex((log) => log.topics[0] === revealTopic)
      const [missing] = logs.splice(index, 1)
      const { sdk, send } = mockOracleSdk(logs, { [id]: request })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      fireEvent.click(await screen.findByTitle(id))
      await screen.findByText("Sentinel evidence is incomplete or inconsistent.")
      expect((screen.getByRole("button", { name: RULING_LABELS.approve }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole("button", { name: RULING_LABELS.deny }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole("button", { name: RULING_LABELS.outOfScope }))
      fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), {
        target: { value: "Evidence unavailable" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      await screen.findByText(/Ruling queued/)
      expect(send).toHaveBeenCalledTimes(1)
      logs.push(missing)
      fireEvent.click(
        within(screen.getByRole("region", { name: "Sentinel activity" })).getByRole("button", { name: "Retry" }),
      )
      await waitForEvidence()
      expect(screen.getByText("No reason supplied")).toBeDefined()
    })

    it.each(["unavailable", "unsafe"] as const)("keeps evidence usable when explorer metadata is %s", async (mode) => {
      const { id, logs, request } = arbitrationCase()
      const { sdk, getChainInfo } = mockOracleSdk(logs, { [id]: request })
      if (mode === "unavailable") getChainInfo.mockRejectedValue(new Error("metadata unavailable"))
      else
        getChainInfo.mockResolvedValue({
          ...CHAIN_INFO,
          blockExplorerUriTemplate: {
            ...CHAIN_INFO.blockExplorerUriTemplate,
            txHash: "javascript:alert('{{txHash}}')",
          },
        })
      renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
      fireEvent.click(await screen.findByTitle(id))
      await waitForEvidence()
      const proposal = screen.getByRole("region", { name: "Proposed transaction" })
      const activity = screen.getByRole("region", { name: "Sentinel activity" })
      expect(within(proposal).queryAllByRole("link")).toEqual([])
      expect(within(activity).queryAllByRole("link")).toEqual([])
      expect(within(activity).getAllByRole("row")).toHaveLength(5)
    })
  })

  describe("rulings", () => {
    type FrozenRequestOptions = { others?: number[]; chainInfoFails?: boolean }

    // Renders a complete case, expanded, once its evidence has loaded. `others` lists plain FROZEN requests to add
    // to the list, unexpanded; `chainInfoFails` makes Safe{Wallet}'s chain metadata unavailable.
    async function renderFrozenRequest({ others = [], chainInfoFails = false }: FrozenRequestOptions = {}) {
      const { id, logs, request } = arbitrationCase()
      const requests: Record<Hex, RequestFixture> = { [id]: request }
      for (const n of others) {
        logs.push(triggered(n))
        requests[requestId(n)] = FROZEN
      }
      const mock = mockOracleSdk(logs, requests)
      if (chainInfoFails) mock.getChainInfo.mockRejectedValue(new Error("metadata unavailable"))
      renderWithQueryClient(<ArbitrationRequestList sdk={mock.sdk} config={CONFIG} safe={SAFE_INFO} />)
      fireEvent.click(await screen.findByTitle(id))
      await waitForEvidence()
      return { ...mock, requests, id, logs }
    }

    it.each(RULINGS)("queues a %s ruling with its rationale", async (ruling) => {
      const { send, id } = await renderFrozenRequest()

      fireEvent.click(rulingButton(ruling))
      expect(rulingForm(ruling)).toBeDefined()
      enterRationale("  Sentinels were right.  ")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      const transaction = send.mock.calls[0][0].txs[0]
      expect(transaction.to).toBe(CONFIG.oracleAddress)
      expect(transaction.value).toBe("0")
      expect(decodeFunctionData({ abi: sentinelOracleAbi, data: transaction.data as Hex })).toEqual(
        ruling === "outOfScope"
          ? { functionName: "markOutOfScope", args: [id, "Sentinels were right."] }
          : { functionName: "resolveDispute", args: [id, ruling === "approve", "Sentinels were right."] },
      )
    })

    it("requires a rationale", async () => {
      await renderFrozenRequest()

      fireEvent.click(rulingButton("approve"))
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

      fireEvent.click(rulingButton("deny"))
      enterRationale("no")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText("Failed to submit ruling: Transaction was rejected")).toBeDefined()
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
    })

    it("closes the form on cancel", async () => {
      const { send } = await renderFrozenRequest()

      fireEvent.click(rulingButton("approve"))
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

      expect(screen.queryByLabelText("Rationale (recorded on-chain)")).toBeNull()
      expect(send).not.toHaveBeenCalled()
    })

    it("keeps a request listed after its ruling is queued, until a refresh shows it closed", async () => {
      const { send, head, requests, id } = await renderFrozenRequest()

      fireEvent.click(rulingButton("deny"))
      enterRationale("no")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      expect(send).toHaveBeenCalledTimes(1)
      expect(screen.getByTitle(id)).toBeDefined()

      // Once the Safe transaction executed, the contract state shows the request closed.
      head.number += 1
      requests[id] = { state: RequestState.RESOLVED_DENIED }
      await refresh()

      await waitFor(() => expect(screen.queryByTitle(id)).toBeNull())
      head.number += 10_000
      await refresh()
      await screen.findByText(`Checked through block ${head.number}`)
      expect(screen.queryByTitle(id)).toBeNull()
    })

    it("proposes once while Safe{Wallet} is open, holding its form and row in place", async () => {
      const { send, id } = await renderFrozenRequest({ others: [2] })
      const proposal = deferred<SendTransactionsResponse>()
      send.mockReturnValueOnce(proposal.promise)
      const rowOf = (key: Hex) => screen.getByTitle(key).closest("tr")!
      const cancel = () => screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement

      fireEvent.click(rulingButton("deny"))
      enterRationale("no")
      // All in one tick, before React re-renders: a double submit, then attempts to leave the form.
      fireEvent.submit(rulingForm("deny"))
      fireEvent.submit(rulingForm("deny"))
      fireEvent.click(rulingButton("approve"))
      fireEvent.click(cancel())
      fireEvent.click(rowOf(requestId(2)))
      fireEvent.click(rowOf(id))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await settle()
      // Once the pending state is shown, the keyboard gets no further than the mouse did.
      await waitFor(() => expect(rulingButton("outOfScope").disabled).toBe(true))
      fireEvent.keyDown(rowOf(requestId(2)), { key: "Enter" })
      fireEvent.keyDown(rowOf(id), { key: " " })
      fireEvent.click(cancel())

      expect(send).toHaveBeenCalledTimes(1)
      expect(cancel().disabled).toBe(true)
      expect(screen.queryByRole("form", { name: RULING_LABELS.approve })).toBeNull()
      expect(rulingForm("deny")).toBeDefined()
      expect(rowOf(id).getAttribute("aria-expanded")).toBe("true")
      expect(rowOf(requestId(2)).getAttribute("aria-expanded")).toBe("false")

      proposal.resolve({ safeTxHash: QUEUED_HASH })
      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      expect(send).toHaveBeenCalledTimes(1)
      // The proposal being queued releases the lock.
      fireEvent.click(rowOf(requestId(2)))
      expect(rowOf(requestId(2)).getAttribute("aria-expanded")).toBe("true")
      expect(rowOf(id).getAttribute("aria-expanded")).toBe("false")
    })

    it("keeps a security ruling's rationale but stops it when the case's evidence is lost", async () => {
      const { send, head, requests, id } = await renderFrozenRequest()
      fireEvent.click(rulingButton("approve"))
      enterRationale("Sentinels were right.")

      // The oracle now counts a commitment that the events found for this case do not show.
      head.number += 1
      requests[id] = { ...requests[id], committedCount: 3 }
      await refresh()
      await screen.findByText("Sentinel evidence is incomplete or inconsistent.")

      expect((screen.getByLabelText("Rationale (recorded on-chain)") as HTMLTextAreaElement).value).toBe(
        "Sentinels were right.",
      )
      expect(rulingButton("approve").disabled).toBe(true)
      // A form can be submitted without its button, e.g. programmatically.
      fireEvent.submit(rulingForm("approve"))
      await settle()
      expect(send).not.toHaveBeenCalled()
      expect(screen.queryByText(/Ruling queued in Safe\{Wallet\}/)).toBeNull()
      // The form itself refused: no proposal was even attempted, so no preflight error either.
      expect(screen.queryByText(/Failed to submit ruling/)).toBeNull()

      expect(rulingButton("outOfScope").disabled).toBe(false)
      fireEvent.click(rulingButton("outOfScope"))
      expect(rulingForm("outOfScope")).toBeDefined()
    })

    it("keeps the queued ruling when Safe{Wallet}'s chain metadata is unavailable", async () => {
      const { send } = await renderFrozenRequest({ chainInfoFails: true })
      send.mockResolvedValueOnce({ safeTxHash: QUEUED_HASH })

      fireEvent.click(rulingButton("deny"))
      enterRationale("no")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
      expect(screen.getByText(QUEUED_HASH)).toBeDefined()
      expect(screen.queryByText(/Failed to submit ruling/)).toBeNull()
      expect(within(rulingForm("deny")).queryByRole("link")).toBeNull()
    })

    it("links the submitting Safe's queue, and never presents the Safe transaction hash as an EVM hash", async () => {
      const { send } = await renderFrozenRequest()
      send.mockResolvedValueOnce({ safeTxHash: QUEUED_HASH })

      fireEvent.click(rulingButton("deny"))
      enterRationale("no")
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))

      const queue = within(rulingForm("deny"))
      const link = (await queue.findByRole("link", { name: "Open in Safe Wallet" })) as HTMLAnchorElement
      const target = new URL(link.href)
      expect(`${target.origin}${target.pathname}`).toBe("https://app.safe.global/transactions/queue")
      expect(target.searchParams.get("safe")).toBe(`gno:${SAFE_INFO.safeAddress}`)
      expect(link.target).toBe("_blank")
      expect(link.rel).toContain("noopener")
      for (const anchor of screen.getAllByRole("link")) {
        expect(anchor.getAttribute("href")).not.toContain(QUEUED_HASH)
      }
    })

    it("links the queue of the Safe that was submitted to, not of one connected since", async () => {
      const { id, logs, request } = arbitrationCase()
      const { sdk, send } = mockOracleSdk(logs, { [id]: request })
      const proposal = deferred<SendTransactionsResponse>()
      send.mockReturnValueOnce(proposal.promise)
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const form = (safe: SafeInfo) => (
        <QueryClientProvider client={client}>
          <RulingForm
            sdk={sdk}
            config={CONFIG}
            safe={safe}
            readReady
            evidenceReady={false}
            requestId={id}
            ruling="outOfScope"
            onClose={vi.fn()}
          />
        </QueryClientProvider>
      )
      const { rerender } = render(form(SAFE_INFO))
      enterRationale("Not for the Council")
      fireEvent.submit(rulingForm("outOfScope"))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      rerender(form({ ...SAFE_INFO, safeAddress: "0x3333333333333333333333333333333333333333" }))
      proposal.resolve({ safeTxHash: QUEUED_HASH })

      const link = (await screen.findByRole("link", { name: "Open in Safe Wallet" })) as HTMLAnchorElement
      expect(new URL(link.href).searchParams.get("safe")).toBe(`gno:${SAFE_INFO.safeAddress}`)
    })

    describe.each([true, undefined])("without explicit write access (isReadOnly=%s)", (isReadOnly) => {
      const READ_ONLY_SAFE = { ...SAFE_INFO, isReadOnly } as SafeInfo

      it("shows a request's details but cannot select a ruling", async () => {
        const { id, logs, request } = arbitrationCase()
        const { sdk, send } = mockOracleSdk(logs, { [id]: request })
        renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={READ_ONLY_SAFE} />)

        fireEvent.click(await screen.findByTitle(id))

        expect(await screen.findByRole("region", { name: "Proposed transaction" })).toBeDefined()
        for (const ruling of RULINGS) {
          const button = rulingButton(ruling)
          expect(button.disabled).toBe(true)
          fireEvent.click(button)
        }
        expect(screen.queryByLabelText("Rationale (recorded on-chain)")).toBeNull()
        expect(send).not.toHaveBeenCalled()
      })

      it("cannot submit a ruling that was started while the Safe could still sign", async () => {
        const { id, logs, request } = arbitrationCase()
        const { sdk, send } = mockOracleSdk(logs, { [id]: request })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const list = (safe: SafeInfo) => (
          <QueryClientProvider client={client}>
            <ArbitrationRequestList sdk={sdk} config={CONFIG} safe={safe} />
          </QueryClientProvider>
        )
        const { rerender } = render(list(SAFE_INFO))
        fireEvent.click(await screen.findByTitle(id))
        await waitForEvidence()
        fireEvent.click(rulingButton("approve"))
        enterRationale("Sentinels were right.")

        rerender(list(READ_ONLY_SAFE))
        expect((screen.getByRole("button", { name: "Submit to Safe" }) as HTMLButtonElement).disabled).toBe(true)
        // A form can be submitted without its button, e.g. programmatically.
        fireEvent.submit(rulingForm("approve"))
        await settle()
        expect(send).not.toHaveBeenCalled()
        expect(screen.queryByText(/Ruling queued in Safe\{Wallet\}/)).toBeNull()
        expect(screen.queryByText(/Failed to submit ruling/)).toBeNull()

        // The Safe regaining signing rights restores the same form, which then submits normally.
        rerender(list(SAFE_INFO))
        fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
        expect(await screen.findByText(/Ruling queued in Safe\{Wallet\}/)).toBeDefined()
        expect(send).toHaveBeenCalledTimes(1)
      })
    })
  })
})
