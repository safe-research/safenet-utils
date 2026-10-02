import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { type Address, decodeFunctionData, encodeFunctionResult, getAddress, type Hex } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "@/App"
import { CONFIG, mockOracleSdk, SAFE_INFO } from "@/__tests__/mock-sentinel-oracle"
import { renderWithQueryClient } from "@/__tests__/render"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { config as APP_CONFIG } from "@/config/oracle"

// The app talks to Safe{Wallet} only through this SDK, which tests replace by the oracle stub of the case at hand.
const session = vi.hoisted(() => ({ sdk: undefined as SafeAppsSDK | undefined }))
vi.mock("@/lib/safe", () => ({
  get sdk() {
    return session.sdk
  },
}))

const ARBITRATOR_SAFE: SafeInfo = { ...SAFE_INFO, safeAddress: `0x${"ab".repeat(20)}` }
// The oracle reports its arbitrator checksummed, whereas the Safe may report its address in any case.
const ARBITRATOR = getAddress(ARBITRATOR_SAFE.safeAddress)
const OTHER_SAFE: SafeInfo = { ...SAFE_INFO, safeAddress: `0x${"cd".repeat(20)}` }

const LIST_HEADING = { name: "Arbitration requests" }

function arbitratorReply(arbitrator: Address): Hex {
  return encodeFunctionResult({ abi: sentinelOracleAbi, functionName: "ARBITRATOR", result: arbitrator })
}

function simulateIframe() {
  vi.spyOn(window, "parent", "get").mockReturnValue({} as Window)
}

// Opens the app in an iframe whose Safe{Wallet} reports `safe` and whose oracle names `ARBITRATOR` its arbitrator.
function openApp(safe: SafeInfo) {
  simulateIframe()
  const oracle = mockOracleSdk([], {}, APP_CONFIG.deploymentBlock + 100)
  const readRequest = oracle.call.getMockImplementation()!
  oracle.call.mockImplementation(async (...args) => {
    const { functionName } = decodeFunctionData({ abi: sentinelOracleAbi, data: args[0][0].data })
    return functionName === "ARBITRATOR" ? arbitratorReply(ARBITRATOR) : readRequest(...args)
  })
  oracle.getInfo.mockResolvedValue(safe)
  session.sdk = oracle.sdk
  renderWithQueryClient(<App />)
  return oracle
}

// Safe{Wallet} is re-checked as soon as the app's page becomes visible again.
async function recheckConnection() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

describe("App", () => {
  afterEach(() => {
    cleanup()
    session.sdk = undefined
    vi.restoreAllMocks()
  })

  it("explains that the connection is unavailable outside of Safe{Wallet}", async () => {
    session.sdk = mockOracleSdk([], {}).sdk

    renderWithQueryClient(<App />)

    expect(await screen.findByText(/connection to Safe\{Wallet\} is unavailable/)).toBeDefined()
    expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()
  })

  it("waits for Safe{Wallet} to answer", () => {
    simulateIframe()
    const oracle = mockOracleSdk([], {})
    oracle.getInfo.mockReturnValue(new Promise(() => {}))
    session.sdk = oracle.sdk

    renderWithQueryClient(<App />)

    expect(screen.getByText(/Connecting to/)).toBeDefined()
  })

  it("asks for a Safe on the configured chain without reading the arbitrator", async () => {
    const { call } = openApp({ ...ARBITRATOR_SAFE, chainId: CONFIG.chainId + 1 })

    expect(await screen.findByText(/Switch to a Safe on that chain/)).toBeDefined()
    expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })

  it("shows the requests of the arbitrator Safe only once the oracle has confirmed its role", async () => {
    // The Safe reports its address in lowercase, the oracle in checksum case.
    const oracle = openApp(ARBITRATOR_SAFE)
    let answer: (reply: Hex) => void = () => {}
    oracle.call.mockImplementationOnce(() => new Promise<Hex>((resolve) => (answer = resolve)))

    expect(await screen.findByText(/Verifying/)).toBeDefined()
    expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()

    answer(arbitratorReply(ARBITRATOR))
    expect(await screen.findByRole("heading", LIST_HEADING)).toBeDefined()
  })

  it("names the arbitrator to a Safe that is not it", async () => {
    openApp(OTHER_SAFE)

    expect(await screen.findByText(ARBITRATOR)).toBeDefined()
    expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()
  })

  it("shows a failed role lookup and recovers on retry", async () => {
    const oracle = openApp(ARBITRATOR_SAFE)
    oracle.call.mockRejectedValueOnce(new Error("rpc unavailable"))

    expect(await screen.findByText(/rpc unavailable/)).toBeDefined()
    expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("heading", LIST_HEADING)).toBeDefined()
  })

  it("lets a read-only session of the arbitrator Safe review requests, with guidance", async () => {
    openApp({ ...ARBITRATOR_SAFE, isReadOnly: true })

    expect(await screen.findByRole("heading", LIST_HEADING)).toBeDefined()
    expect(screen.getByText(/read-only/)).toBeDefined()
  })

  describe("when Safe{Wallet} changes under the open app", () => {
    async function openArbitratorApp() {
      const oracle = openApp(ARBITRATOR_SAFE)
      await screen.findByRole("heading", LIST_HEADING)
      return oracle
    }

    it("withdraws the requests from a Safe that is not the arbitrator", async () => {
      const { getInfo } = await openArbitratorApp()

      getInfo.mockResolvedValue(OTHER_SAFE)
      await recheckConnection()

      expect(await screen.findByText(ARBITRATOR)).toBeDefined()
      expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()
    })

    it("withdraws the requests when the connection can no longer be confirmed", async () => {
      const { getInfo } = await openArbitratorApp()

      getInfo.mockRejectedValue(new Error("boom"))
      await recheckConnection()

      expect(await screen.findByText(/connection to Safe\{Wallet\} is unavailable/)).toBeDefined()
      expect(screen.queryByRole("heading", LIST_HEADING)).toBeNull()
    })

    it("adds the read-only guidance when the session loses its ability to sign", async () => {
      const { getInfo } = await openArbitratorApp()
      expect(screen.queryByText(/read-only/)).toBeNull()

      getInfo.mockResolvedValue({ ...ARBITRATOR_SAFE, isReadOnly: true })
      await recheckConnection()

      await waitFor(() => expect(screen.getByText(/read-only/)).toBeDefined())
      expect(screen.getByRole("heading", LIST_HEADING)).toBeDefined()
    })
  })
})
