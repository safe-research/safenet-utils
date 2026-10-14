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
import { consensusAbi } from "@/abi/consensusAbi"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { oracleRequestId, type SafeTransaction } from "@/lib/requestProposal"

export const CONFIG = parseConfig({})

// The mocked oracle's `PROPOSER` and `COMMIT_WINDOW`.
export const CONSENSUS: Address = "0xC0C0c0c0C0C0c0c0c0C0c0C0C0C0C0C0C0C0c0c0"
export const COMMIT_WINDOW = 10

type RequestFixture = {
  state: (typeof RequestState)[keyof typeof RequestState]
  sponsor?: Address
  commitDeadline?: bigint
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

export const SAFE_TRANSACTION: SafeTransaction = {
  chainId: 1n,
  safe: "0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE",
  to: "0x7070707070707070707070707070707070707070",
  value: 1234n,
  data: "0xdeadbeef",
  operation: 1,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: 42n,
}

type ProposalFixture = { epoch?: bigint; oracleData?: Hex; safeTxHash?: Hex; transaction?: SafeTransaction }

// A raw `TransactionProposed` log proposing a transaction to the configured oracle, with the request ID
// `Consensus.proposeTransaction` would have posted for it.
export function proposalLog(proposal: ProposalFixture = {}, blockNumber = 1) {
  const {
    epoch = 7n,
    oracleData = "0x",
    safeTxHash = `0x${"5a".repeat(32)}`,
    transaction = SAFE_TRANSACTION,
  } = proposal
  const topics = encodeEventTopics({
    abi: consensusAbi,
    eventName: "TransactionProposed",
    args: { safeTxHash, safeId: `0x${"00".repeat(32)}`, oracle: CONFIG.oracleAddress },
  }) as Hex[]
  // Everything after the three indexed inputs is the log data.
  const data = encodeAbiParameters(consensusAbi[0].inputs.slice(3), [epoch, oracleData, transaction])
  const id = oracleRequestId({
    chainId: CONFIG.chainId,
    consensus: CONSENSUS,
    epoch,
    oracle: CONFIG.oracleAddress,
    oracleData,
    safeTxHash,
  })
  return { id, log: { address: CONSENSUS, topics, data, blockNumber, transactionHash: `0x${"7c".repeat(32)}` as Hex } }
}

type MockLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: number; transactionHash?: Hex }
type LogFilter = { address: Address; fromBlock: number; toBlock: number; topics: (Hex | Hex[] | null)[] }

function matchesFilter(log: MockLog, { address, fromBlock, toBlock, topics }: LogFilter) {
  return (
    log.address.toLowerCase() === address.toLowerCase() &&
    log.blockNumber >= fromBlock &&
    log.blockNumber <= toBlock &&
    topics.every((topic, i) => topic === null || [topic].flat().includes(log.topics[i]))
  )
}

// A Safe Apps SDK stub on a chain at `latestBlock`: `getPastLogs` returns the `logs` matching the requested filter and
// `eth_call` answers the oracle's `getRequest` from `requests`. `txs.send` accepts every proposed transaction.
export function mockOracleSdk(logs: MockLog[], requests: Record<Hex, RequestFixture>, latestBlock = 100) {
  const getBlockByNumber = vi.fn(async () => ({ number: latestBlock }))
  const getPastLogs = vi.fn(async ([filter]: [LogFilter]) => logs.filter((log) => matchesFilter(log, filter)))
  const call = vi.fn(async ([tx]: [{ data: Hex }]) => {
    const decoded = decodeFunctionData({ abi: sentinelOracleAbi, data: tx.data })
    if (decoded.functionName === "PROPOSER") {
      return encodeFunctionResult({ abi: sentinelOracleAbi, functionName: "PROPOSER", result: CONSENSUS })
    }
    if (decoded.functionName === "COMMIT_WINDOW") {
      return encodeFunctionResult({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW", result: COMMIT_WINDOW })
    }
    if (decoded.functionName !== "getRequest") {
      throw new Error(`unexpected call to ${decoded.functionName}`)
    }
    const fixture = requests[decoded.args[0]]
    return encodeFunctionResult({
      abi: sentinelOracleAbi,
      functionName: "getRequest",
      result: {
        terms: {
          // Created in block 1 unless given, which matches `proposalLog`'s default block.
          commitDeadline: fixture.commitDeadline ?? BigInt(1 + COMMIT_WINDOW),
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
