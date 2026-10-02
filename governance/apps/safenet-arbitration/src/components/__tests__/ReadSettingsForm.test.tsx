import type { Log } from "@safe-global/safe-apps-sdk"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { type Hex, numberToHex } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  arbitrationCase,
  CONFIG,
  disputeLog,
  mockOracleSdk,
  type RequestFixture,
  requestId,
  SAFE_INFO,
  SAFE_TRANSACTION,
  sentinelLog,
} from "@/__tests__/mock-sentinel-oracle"
import { renderWithQueryClient } from "@/__tests__/render"
import { RequestState } from "@/abi/sentinelOracleAbi"
import { ArbitrationRequestList } from "@/components/ArbitrationRequestList"

const ARCHIVE = "https://archive.example.invalid/private-api-key"
const FROZEN: RequestFixture = { state: RequestState.FROZEN }

function archiveRpc(logs: Log[], states: Record<Hex, RequestFixture> = {}, chainId = 100) {
  const remote = mockOracleSdk(logs, states, 999)
  const methods: Record<string, (params: unknown[]) => Promise<unknown>> = {
    eth_chainId: async () => numberToHex(chainId),
    eth_getLogs: async (params) => remote.getPastLogs(params as Parameters<typeof remote.getPastLogs>[0]),
    eth_call: async (params) => remote.call(params as Parameters<typeof remote.call>[0]),
    eth_getBlockByNumber: async (params) =>
      remote.getBlockByNumber(params as Parameters<typeof remote.getBlockByNumber>[0]),
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const payload = (await request.json()) as { id: number; method: string; params: unknown[] }
      const method = methods[payload.method]
      if (!method) throw new Error(`Unexpected archive method ${payload.method}`)
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: await method(payload.params) }), {
        headers: { "Content-Type": "application/json" },
      })
    }),
  )
  return remote
}

function applySettings(lookback: string, rpcUrl = "") {
  const summary = screen.getByText("Search settings")
  if (!summary.closest("details")!.open) fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText("Lookback blocks"), { target: { value: lookback } })
  fireEvent.change(screen.getByLabelText("Custom RPC URL (optional)"), { target: { value: rpcUrl } })
  fireEvent.submit(screen.getByRole("form", { name: "Search settings" }))
}

async function expand(id: Hex) {
  fireEvent.click(await screen.findByTitle(id))
}

function securityButton() {
  return screen.getByRole("button", { name: "Rule secure" }) as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("read settings", () => {
  it("limits discovery, searches all history when cleared, and explains an empty narrow window", async () => {
    const recent = requestId(1)
    const old = requestId(2)
    const { sdk } = mockOracleSdk(
      [disputeLog("DisputeTriggered", recent, 19_950), disputeLog("DisputeTriggered", old, 500)],
      { [recent]: FROZEN, [old]: FROZEN },
      20_000,
    )
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await screen.findByTitle(recent)
    expect(screen.queryByTitle(old)).toBeNull()

    applySettings("")
    await screen.findByTitle(old, {}, { timeout: 3000 })
    expect(screen.getByTitle(recent)).toBeDefined()

    applySettings("10")
    await waitFor(() => expect(screen.queryByTitle(recent)).toBeNull())
    expect(screen.queryByTitle(old)).toBeNull()
    expect(await screen.findByText(/Older disputes may exist/)).toBeDefined()
  })

  it("still verifies a proposal older than the selected discovery window", async () => {
    const { id, logs, request } = arbitrationCase({}, 10)
    const { sdk } = mockOracleSdk(logs, { [id]: request }, 23)
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await screen.findByTitle(id)
    applySettings("2")
    await screen.findByText("Search range: blocks 22–23.")
    await expand(id)
    await waitFor(() => expect(securityButton().disabled).toBe(false))
    expect(screen.getByText(SAFE_TRANSACTION.safe)).toBeDefined()
  })

  it("loads missing historical evidence from the archive and restores Wallet reads when cleared", async () => {
    const { id, logs, request } = arbitrationCase()
    const trigger = logs[logs.length - 1]
    const { sdk, send } = mockOracleSdk([trigger], { [id]: request })
    archiveRpc(logs)
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await expand(id)
    await screen.findByText("No proposal matching this request was found.")
    expect(securityButton().disabled).toBe(true)

    applySettings("10000", ARCHIVE)
    await waitFor(() => expect(screen.queryByRole("region", { name: "Proposed transaction" })).toBeNull())
    await expand(id)
    await waitFor(() => expect(securityButton().disabled).toBe(false))
    expect(screen.getByText("R-4.1")).toBeDefined()

    applySettings("10000")
    await waitFor(() => expect(screen.queryByRole("region", { name: "Proposed transaction" })).toBeNull())
    await expand(id)
    await screen.findByText("No proposal matching this request was found.")
    expect(securityButton().disabled).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects a wrong-chain archive without discarding the current case", async () => {
    const { id, logs, request } = arbitrationCase()
    const { sdk, send } = mockOracleSdk(logs, { [id]: request })
    archiveRpc(logs, {}, 1)
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await expand(id)
    await waitFor(() => expect(securityButton().disabled).toBe(false))
    fireEvent.click(securityButton())
    fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), {
      target: { value: "Keep this rationale" },
    })
    applySettings("10000", ARCHIVE)
    await screen.findByRole("alert")
    expect(screen.getByTitle(id)).toBeDefined()
    expect((screen.getByLabelText("Rationale (recorded on-chain)") as HTMLTextAreaElement).value).toBe(
      "Keep this rationale",
    )
    expect(send).not.toHaveBeenCalled()
  })

  it("does not let a custom RPC validate its own forged sentinel counts", async () => {
    const { id, logs, request } = arbitrationCase()
    const { sdk, send } = mockOracleSdk([logs[logs.length - 1]], { [id]: request })
    const forged = [...logs]
    forged[4] = sentinelLog({
      requestId: id,
      sentinel: "0x3333333333333333333333333333333333333333",
      action: "approved",
      reason: "Forged approval",
      blockNumber: 13,
    })
    archiveRpc(forged, { [id]: { ...request, approve: 2, deny: 0 } })
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await screen.findByTitle(id)
    applySettings("10000", ARCHIVE)
    await screen.findByText(/ · Custom RPC$/)
    await expand(id)
    await screen.findByText("Sentinel evidence is incomplete or inconsistent.")
    expect(securityButton().disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Rule insecure" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Out of scope" }) as HTMLButtonElement).disabled).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it("keeps settings locked if a proposal starts during RPC validation", async () => {
    const { id, logs, request } = arbitrationCase()
    const { sdk, send } = mockOracleSdk(logs, { [id]: request })
    const check = Promise.withResolvers<void>()
    const proposal = Promise.withResolvers<{ safeTxHash: string }>()
    send.mockReturnValue(proposal.promise)
    archiveRpc(logs)
    const fetchRpc = globalThis.fetch
    const delayedFetch = vi.fn(async (...args: Parameters<typeof fetchRpc>) => {
      await check.promise
      return fetchRpc(...args)
    })
    vi.stubGlobal("fetch", delayedFetch)
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    try {
      await expand(id)
      await waitFor(() => expect(securityButton().disabled).toBe(false))
      applySettings("50", ARCHIVE)
      await screen.findByText("Checking RPC…")
      fireEvent.click(securityButton())
      fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), {
        target: { value: "Preserve the pending proposal" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      check.resolve()
      await screen.findByRole("alert")
      expect(screen.getByLabelText("Lookback blocks").matches(":disabled")).toBe(true)
      expect((screen.getByLabelText("Rationale (recorded on-chain)") as HTMLTextAreaElement).value).toBe(
        "Preserve the pending proposal",
      )
      fireEvent.submit(screen.getByRole("form", { name: "Search settings" }))
      expect(delayedFetch).toHaveBeenCalledTimes(1)
      expect(screen.getByTitle(id)).toBeDefined()
    } finally {
      check.resolve()
      proposal.resolve({ safeTxHash: requestId(99) })
    }
    await screen.findByText(/Ruling queued/)
  })

  it("does not revive pre-reorg evidence when the discovery window changes", async () => {
    const { id, logs, request } = arbitrationCase()
    const { sdk, blockHashes } = mockOracleSdk(logs, { [id]: request })
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    await expand(id)
    await screen.findByText("R-4.1")
    logs[4] = sentinelLog({
      requestId: id,
      sentinel: "0x3333333333333333333333333333333333333333",
      action: "denied",
      reason: "Replacement history",
      blockNumber: 13,
    })
    blockHashes.set(100, requestId(777))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await screen.findByText("Replacement history")

    applySettings("200")
    await screen.findByText(/Last 200 blocks/)
    await expand(id)
    await screen.findByText("Replacement history")
    expect(screen.queryByText("R-4.1")).toBeNull()
    await waitFor(() => expect(securityButton().disabled).toBe(false))
  })

  it("retains pending feedback when the rolling window excludes the selected request", async () => {
    const { id, logs, request } = arbitrationCase({}, 9989)
    const { sdk, send, head } = mockOracleSdk(logs, { [id]: request }, 20_000)
    const proposal = Promise.withResolvers<{ safeTxHash: string }>()
    const queuedHash = requestId(101)
    send.mockReturnValue(proposal.promise)
    renderWithQueryClient(<ArbitrationRequestList sdk={sdk} config={CONFIG} safe={SAFE_INFO} />)
    try {
      await expand(id)
      await waitFor(() => expect(securityButton().disabled).toBe(false))
      fireEvent.click(securityButton())
      fireEvent.change(screen.getByLabelText("Rationale (recorded on-chain)"), {
        target: { value: "Keep the proposal feedback" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Submit to Safe" }))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      head.number = 20_001
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
      await screen.findByText("Search range: blocks 10002–20001.")
      expect((screen.getByLabelText("Rationale (recorded on-chain)") as HTMLTextAreaElement).value).toBe(
        "Keep the proposal feedback",
      )
    } finally {
      proposal.resolve({ safeTxHash: queuedHash })
    }
    await screen.findByText(queuedHash)
    expect(securityButton().disabled).toBe(true)
    fireEvent.click(screen.getByTitle(id))
    await waitFor(() => expect(screen.queryByTitle(id)).toBeNull())
  })
})
