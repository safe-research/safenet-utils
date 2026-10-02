import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { type Address, decodeFunctionData, encodeFunctionResult, type Hex } from "viem"
import { describe, expect, it, type Mock, vi } from "vitest"
import {
  arbitrationCase,
  CONFIG,
  mockOracleSdk,
  type RequestFixture,
  requestId,
  SAFE_INFO,
} from "@/__tests__/mock-sentinel-oracle"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { encodeRuling, RULINGS, type Ruling, type SubmitRulingInput, submitRuling } from "@/lib/rulings"

// Selectors are from the compiled contract at the ABI's pinned commit, guarding against a mistyped fragment.
// Multi-line, non-ASCII and longer than one ABI word, so the dynamic `string` encoding is actually exercised.
const CONTEXT = "Sentinels 1–3 missed the delegatecall.\nSee https://forum.example/t/42 — ruling: approve ✅".repeat(2)

describe("encodeRuling", () => {
  it("encodes approve as resolveDispute in favour of the approving sentinels", () => {
    const data = encodeRuling(requestId(0xabc), "approve", CONTEXT)

    expect(data.slice(0, 10)).toBe("0x795e0a79")
    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "resolveDispute",
      args: [requestId(0xabc), true, CONTEXT],
    })
  })

  it("encodes deny as resolveDispute in favour of the denying sentinels", () => {
    const data = encodeRuling(requestId(0xabc), "deny", CONTEXT)

    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "resolveDispute",
      args: [requestId(0xabc), false, CONTEXT],
    })
  })

  it("encodes a declined ruling as markOutOfScope", () => {
    const data = encodeRuling(requestId(0xabc), "outOfScope", CONTEXT)

    expect(data.slice(0, 10)).toBe("0x4ffcdfa1")
    expect(decodeFunctionData({ abi: sentinelOracleAbi, data })).toEqual({
      functionName: "markOutOfScope",
      args: [requestId(0xabc), CONTEXT],
    })
  })
})

const CASE = arbitrationCase()
const HASH: Hex = `0x${"cd".repeat(32)}`
const RATIONALE = "Sentinels 1–3 verified the delegatecall."
const OTHER_SAFE = "0x4444444444444444444444444444444444444444"
// Has letters, so its checksummed, lower and upper case spellings all differ.
const CHECKSUMMED_SAFE: Address = "0xE6821708C9f443E52EC9c77ef9e0ecDB5b195cc8"

// The `eth_call` parameters `mockOracleSdk` accepts.
type CallTx = { data: Hex; from?: string; value?: string; to?: string }

// The parts of `mockOracleSdk` these tests drive, along with the request states it serves.
interface OracleMock {
  sdk: SafeAppsSDK
  requests: Record<Hex, RequestFixture>
  call: Mock<(params: [CallTx, string?]) => Promise<Hex>>
  send: Mock<SafeAppsSDK["txs"]["send"]>
  getInfo: Mock<() => Promise<SafeInfo>>
  getChainInfo: Mock<() => Promise<unknown>>
}

function setup(request: RequestFixture = CASE.request): OracleMock {
  const requests: Record<Hex, RequestFixture> = { [CASE.id]: { ...request } }
  return { ...mockOracleSdk([], requests), requests }
}

function input(overrides: Partial<SubmitRulingInput> = {}): SubmitRulingInput {
  return {
    requestId: CASE.id,
    ruling: "approve",
    context: RATIONALE,
    expectedSafeAddress: SAFE_INFO.safeAddress,
    evidenceReady: true,
    ...overrides,
  }
}

const calledFunction = ({ data }: CallTx) => decodeFunctionData({ abi: sentinelOracleAbi, data }).functionName

// The ruling simulations that were requested: reads never name a caller, only a simulation does.
const simulations = ({ call }: OracleMock) =>
  call.mock.calls.map(([params]) => params).filter(([tx]) => tx.from !== undefined)

// Answers the `eth_call`s `handle` returns a promise for in place of the oracle fixture, which keeps all the others.
function intercept({ call }: OracleMock, handle: (tx: CallTx) => Promise<Hex> | undefined) {
  const respond = call.getMockImplementation()
  if (!respond) throw new Error("The oracle fixture has no eth_call implementation")
  call.mockImplementation((params) => handle(params[0]) ?? respond(params))
}

function failCalls(mock: OracleMock, fails: (tx: CallTx) => boolean, message: string) {
  intercept(mock, (tx) => (fails(tx) ? Promise.reject(new Error(message)) : undefined))
}

// Keeps the ruling simulation in flight until the returned function is called, so the world can change meanwhile.
function holdSimulation(mock: OracleMock): () => void {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  intercept(mock, (tx) => (tx.from === undefined ? undefined : released.then((): Hex => "0x")))
  return release
}

// The one call handed to the Wallet.
function sentCall({ send }: OracleMock) {
  expect(send).toHaveBeenCalledTimes(1)
  const [{ txs }] = send.mock.calls[0]
  expect(txs).toHaveLength(1)
  return { to: txs[0].to, value: txs[0].value, data: txs[0].data as Hex }
}

type Rejection = {
  name: string
  message: RegExp
  overrides?: Partial<SubmitRulingInput>
  arrange?: (mock: OracleMock) => void
}

const REJECTIONS: Rejection[] = [
  { name: "a blank rationale", overrides: { context: " \n\t " }, message: /rationale/ },
  {
    name: "unverified evidence for a security ruling",
    overrides: { ruling: "deny", evidenceReady: false },
    message: /evidence/,
  },
  {
    name: "a connected Safe other than the expected one",
    overrides: { expectedSafeAddress: OTHER_SAFE },
    message: /prepared for/,
  },
  {
    name: "a Safe on another chain",
    arrange: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, chainId: 1 }),
    message: /on chain 1,/,
  },
  {
    name: "a read-only Safe",
    arrange: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, isReadOnly: true }),
    message: /read-only/,
  },
  {
    name: "a Safe without explicit write access",
    arrange: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, isReadOnly: undefined } as unknown as SafeInfo),
    message: /read-only/,
  },
  {
    name: "an expected Safe that is not the arbitrator",
    overrides: { expectedSafeAddress: OTHER_SAFE },
    arrange: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, safeAddress: OTHER_SAFE }),
    message: /not the oracle's arbitrator/,
  },
  {
    name: "an unreadable Safe",
    arrange: ({ getInfo }) => getInfo.mockRejectedValue(new Error("wallet unavailable")),
    message: /Could not read the connected Safe: wallet unavailable/,
  },
  {
    name: "a failed arbitrator read",
    arrange: (mock) => failCalls(mock, (tx) => calledFunction(tx) === "ARBITRATOR", "rpc down"),
    message: /Could not read the oracle's arbitrator: rpc down/,
  },
  {
    name: "a failed state read",
    arrange: (mock) => failCalls(mock, (tx) => calledFunction(tx) === "getRequest", "rpc down"),
    message: /Could not read the request's state: rpc down/,
  },
  ...Object.values(RequestState)
    .filter((state) => state !== RequestState.FROZEN)
    .map((state): Rejection => ({
      name: `a request in on-chain state ${state}`,
      arrange: ({ requests }) => {
        requests[CASE.id] = { ...CASE.request, state }
      },
      message: /not awaiting arbitration/,
    })),
]

const CHANGES: { name: string; change: (mock: OracleMock) => void; message: RegExp }[] = [
  {
    name: "another Safe is connected",
    change: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, safeAddress: OTHER_SAFE }),
    message: /prepared for/,
  },
  {
    name: "the Safe moves to another chain",
    change: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, chainId: 1 }),
    message: /on chain 1,/,
  },
  {
    name: "the Safe becomes read-only",
    change: ({ getInfo }) => getInfo.mockResolvedValue({ ...SAFE_INFO, isReadOnly: true }),
    message: /read-only/,
  },
  {
    name: "the request is settled",
    change: ({ requests }) => {
      requests[CASE.id] = { ...CASE.request, state: RequestState.RESOLVED_DENIED }
    },
    message: /not awaiting arbitration/,
  },
]

const OUTCOMES: [Ruling, { functionName: string; args: unknown[] }][] = [
  ["approve", { functionName: "resolveDispute", args: [CASE.id, true, RATIONALE] }],
  ["deny", { functionName: "resolveDispute", args: [CASE.id, false, RATIONALE] }],
  ["outOfScope", { functionName: "markOutOfScope", args: [CASE.id, RATIONALE] }],
]

describe("submitRuling", () => {
  it.each(OUTCOMES)("queues one %s ruling with the trimmed rationale", async (ruling, outcome) => {
    const mock = setup()
    mock.send.mockResolvedValue({ safeTxHash: HASH })

    const result = await submitRuling(mock.sdk, CONFIG, input({ ruling, context: `  ${RATIONALE}\n\t` }))

    expect(result).toEqual({ safeTxHash: HASH, safeAddress: SAFE_INFO.safeAddress, chainId: CONFIG.chainId })
    const sent = sentCall(mock)
    expect(sent).toMatchObject({ to: CONFIG.oracleAddress, value: "0" })
    expect(decodeFunctionData({ abi: sentinelOracleAbi, data: sent.data })).toEqual(outcome)
  })

  it("simulates the exact proposed call as the Arbitrator Safe on the latest state", async () => {
    const mock = setup()

    await submitRuling(mock.sdk, CONFIG, input({ ruling: "deny" }))

    expect(simulations(mock)).toEqual([
      [{ to: CONFIG.oracleAddress, from: SAFE_INFO.safeAddress, value: "0x0", data: sentCall(mock).data }, "latest"],
    ])
  })

  it.each(RULINGS)("accepts a %s ruling on a FROZEN request past its arbitration deadline", async (ruling) => {
    // The fixture's head is block 100, so a deadline of 1 passed long ago.
    const mock = setup({ ...CASE.request, deadline: 1n })

    await submitRuling(mock.sdk, CONFIG, input({ ruling }))

    expect(mock.send).toHaveBeenCalledTimes(1)
  })

  it("lets Out of scope through without evidence when the role and state check out", async () => {
    const mock = setup()

    await submitRuling(mock.sdk, CONFIG, input({ ruling: "outOfScope", evidenceReady: false }))

    const { functionName } = decodeFunctionData({ abi: sentinelOracleAbi, data: sentCall(mock).data })
    expect(functionName).toBe("markOutOfScope")
  })

  it("compares the connected, expected and arbitrator Safe addresses case-insensitively", async () => {
    const mock = setup()
    mock.getInfo.mockResolvedValue({ ...SAFE_INFO, safeAddress: CHECKSUMMED_SAFE.toLowerCase() })
    intercept(mock, (tx) => {
      if (calledFunction(tx) === "ARBITRATOR") {
        const result = encodeFunctionResult({
          abi: sentinelOracleAbi,
          functionName: "ARBITRATOR",
          result: CHECKSUMMED_SAFE,
        })
        return Promise.resolve(result)
      }
      return tx.from === undefined ? undefined : Promise.resolve<Hex>("0x")
    })

    const result = await submitRuling(
      mock.sdk,
      CONFIG,
      input({ expectedSafeAddress: `0x${CHECKSUMMED_SAFE.slice(2).toUpperCase()}` }),
    )

    expect(result.safeAddress).toBe(CHECKSUMMED_SAFE)
    expect(simulations(mock)[0][0].from).toBe(CHECKSUMMED_SAFE)
  })

  it.each(REJECTIONS)("refuses $name before simulating or queueing anything", async (rejection) => {
    const mock = setup()
    rejection.arrange?.(mock)

    await expect(submitRuling(mock.sdk, CONFIG, input(rejection.overrides))).rejects.toThrow(rejection.message)

    expect(simulations(mock)).toEqual([])
    expect(mock.send).not.toHaveBeenCalled()
  })

  it.each(CHANGES)("queues nothing when $name during the simulation", async ({ change, message }) => {
    const mock = setup()
    const release = holdSimulation(mock)

    const outcome = expect(submitRuling(mock.sdk, CONFIG, input())).rejects.toThrow(message)
    await vi.waitFor(() => expect(simulations(mock)).toHaveLength(1))
    change(mock)
    release()

    await outcome
    expect(mock.send).not.toHaveBeenCalled()
  })

  it("keeps the provider's message when the simulation fails, without calling it a revert", async () => {
    const mock = setup()
    failCalls(mock, (tx) => tx.from !== undefined, "503 upstream unavailable")

    const error = (await submitRuling(mock.sdk, CONFIG, input()).catch((caught: unknown) => caught)) as Error

    expect(error.message).toContain("503 upstream unavailable")
    expect(error.message).not.toMatch(/revert/i)
    expect((error.cause as Error).message).toBe("503 upstream unavailable")
    expect(mock.send).not.toHaveBeenCalled()
  })

  it("repeats every check when retried after a failed simulation", async () => {
    const mock = setup()
    let recovered = false
    failCalls(mock, (tx) => tx.from !== undefined && !recovered, "execution reverted")

    await expect(submitRuling(mock.sdk, CONFIG, input())).rejects.toThrow(/execution reverted/)
    mock.requests[CASE.id] = { ...CASE.request, state: RequestState.RESOLVED_APPROVED }
    await expect(submitRuling(mock.sdk, CONFIG, input())).rejects.toThrow(/not awaiting arbitration/)
    mock.requests[CASE.id] = { ...CASE.request }
    recovered = true
    await submitRuling(mock.sdk, CONFIG, input())

    expect(mock.send).toHaveBeenCalledTimes(1)
    expect(simulations(mock)).toHaveLength(2)
  })

  it("hands the ruling to the Wallet once and does not retry a rejected proposal", async () => {
    const mock = setup()
    mock.send.mockRejectedValue(new Error("User rejected the request"))

    await expect(submitRuling(mock.sdk, CONFIG, input())).rejects.toThrow("User rejected the request")

    expect(mock.send).toHaveBeenCalledTimes(1)
  })

  it("reports the Safe it proposed from, not the one connected afterwards", async () => {
    const mock = setup()
    mock.send.mockImplementation(async () => {
      mock.getInfo.mockResolvedValue({ ...SAFE_INFO, safeAddress: OTHER_SAFE, chainId: 1 })
      return { safeTxHash: HASH }
    })

    await expect(submitRuling(mock.sdk, CONFIG, input())).resolves.toEqual({
      safeTxHash: HASH,
      safeAddress: SAFE_INFO.safeAddress,
      chainId: CONFIG.chainId,
    })
  })

  it("still reports success when the chain metadata is unavailable", async () => {
    const mock = setup()
    mock.getChainInfo.mockRejectedValue(new Error("metadata unavailable"))

    await expect(submitRuling(mock.sdk, CONFIG, input())).resolves.toMatchObject({ chainId: CONFIG.chainId })
  })
})
