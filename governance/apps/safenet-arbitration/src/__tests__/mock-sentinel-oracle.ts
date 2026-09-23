import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import {
  type Address,
  type ContractEventName,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
} from "viem"
import { vi } from "vitest"
import { parseConfig } from "@/config/oracle"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"

export const CONFIG = parseConfig({})

type RequestFixture = {
  state: (typeof RequestState)[keyof typeof RequestState]
  sponsor?: Address
  approve?: number
  deny?: number
  deadline?: bigint
}

export function requestId(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`
}

// A raw log as `eth_getLogs` would return it for the given dispute lifecycle event.
export function disputeLog(eventName: ContractEventName<typeof sentinelOracleAbi>, id: Hex, blockNumber = 1) {
  const topics = encodeEventTopics({ abi: sentinelOracleAbi, eventName, args: { requestId: id } }) as Hex[]
  const data: Record<string, Hex> = {
    DisputeTriggered: encodeAbiParameters([{ type: "uint64" }], [1000n]),
    DisputeResolved: encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint128" }, { type: "string" }],
      [RequestState.RESOLVED_APPROVED, 0n, "ruling"],
    ),
    DisputeOutOfScope: encodeAbiParameters([{ type: "string" }], ["out of scope"]),
    ArbitrationTimedOut: "0x",
  }
  return { address: CONFIG.oracleAddress, topics, data: data[eventName], blockNumber }
}

// A Safe Apps SDK stub on a chain at `latestBlock`: `getPastLogs` returns the `logs` within the requested block range
// and `eth_call` answers `getRequest` from `requests`. `txs.send` accepts every proposed transaction.
export function mockOracleSdk(
  logs: ReturnType<typeof disputeLog>[],
  requests: Record<Hex, RequestFixture>,
  latestBlock = 100,
) {
  const getBlockByNumber = vi.fn(async () => ({ number: latestBlock }))
  const getPastLogs = vi.fn(async ([{ fromBlock, toBlock }]: [{ fromBlock: number; toBlock: number }]) =>
    logs.filter(({ blockNumber }) => blockNumber >= fromBlock && blockNumber <= toBlock),
  )
  const call = vi.fn(async ([tx]: [{ data: Hex }]) => {
    const { args } = decodeFunctionData({ abi: sentinelOracleAbi, data: tx.data })
    const fixture = requests[args[0]]
    return encodeFunctionResult({
      abi: sentinelOracleAbi,
      functionName: "getRequest",
      result: {
        terms: {
          commitDeadline: 1n,
          daoFeeShare: 0,
          revealDeadline: 2n,
          bondTarget: 0n,
          _padding: 0,
          sponsor: fixture.sponsor ?? "0x1111111111111111111111111111111111111111",
          slashAmount: 0n,
        },
        progress: {
          state: fixture.state,
          fee: 0n,
          arbitrationDeadline: fixture.deadline ?? 0n,
          committedCount: (fixture.approve ?? 0) + (fixture.deny ?? 0),
          revealedCount: (fixture.approve ?? 0) + (fixture.deny ?? 0),
          approveSentinelCount: fixture.approve ?? 0,
          denySentinelCount: fixture.deny ?? 0,
          _padding: 0,
        },
      },
    })
  })
  const send = vi.fn(async () => ({ safeTxHash: `0x${"ab".repeat(32)}` }))
  const sdk = { eth: { getBlockByNumber, getPastLogs, call }, txs: { send } } as unknown as SafeAppsSDK
  return { sdk, getBlockByNumber, getPastLogs, call, send }
}
