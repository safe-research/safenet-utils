import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { Log, SafeInfo } from "@safe-global/safe-apps-sdk"
import {
  type Address,
  concatHex,
  type ContractEventName,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  keccak256,
} from "viem"
import { vi } from "vitest"
import { parseConfig } from "@/config/oracle"
import { consensusAbi } from "@/abi/consensusAbi"
import { RequestState, sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { calculateSafeTxHash, oracleRequestId, type SafeTransaction } from "@/lib/requestProposal"

export const CONFIG = parseConfig({ VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: "0" })
export const SAFE_INFO: SafeInfo = {
  safeAddress: "0x1111111111111111111111111111111111111111",
  chainId: CONFIG.chainId,
  threshold: 1,
  owners: ["0x2222222222222222222222222222222222222222"],
  isReadOnly: false,
}
export const CHAIN_INFO = {
  chainId: String(CONFIG.chainId),
  chainName: "Gnosis",
  shortName: "gno",
  nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18, logoUri: "" },
  blockExplorerUriTemplate: {
    address: "https://explorer.test/address/{{address}}",
    txHash: "https://explorer.test/tx/{{txHash}}",
    api: "https://explorer.test/api",
  },
}
export const CONSENSUS: Address = `0x${"c0".repeat(20)}`
export const COMMIT_WINDOW = 10

export type RequestFixture = {
  state: (typeof RequestState)[keyof typeof RequestState]
  sponsor?: Address
  commitDeadline?: bigint
  approve?: number
  deny?: number
  deadline?: bigint
  committedCount?: number
  revealedCount?: number
}

export function requestId(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`
}

export function disputeLog(
  eventName: ContractEventName<typeof sentinelOracleAbi>,
  id: Hex,
  blockNumber = 1,
  logIndex = 0,
): Log {
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
  return {
    address: CONFIG.oracleAddress,
    topics,
    data: data[eventName],
    blockNumber,
    blockHash: requestId(blockNumber),
    transactionHash: keccak256(concatHex([id, topics[0], requestId(blockNumber)])),
    transactionIndex: 0,
    logIndex,
  }
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

export function proposalLog(proposal: ProposalFixture = {}, blockNumber = 1, logIndex = 0) {
  const { epoch = 7n, oracleData = "0x", transaction = SAFE_TRANSACTION } = proposal
  const safeTxHash = proposal.safeTxHash ?? calculateSafeTxHash(transaction)
  const topics = encodeEventTopics({
    abi: consensusAbi,
    eventName: "TransactionProposed",
    args: { safeTxHash, safeId: `0x${"00".repeat(32)}`, oracle: CONFIG.oracleAddress },
  }) as Hex[]
  const data = encodeAbiParameters(consensusAbi[0].inputs.slice(3), [epoch, oracleData, transaction])
  const id = oracleRequestId({
    chainId: CONFIG.chainId,
    consensus: CONSENSUS,
    epoch,
    oracle: CONFIG.oracleAddress,
    oracleData,
    safeTxHash,
  })
  const log: Log = {
    address: CONSENSUS,
    topics,
    data,
    blockNumber,
    blockHash: requestId(blockNumber),
    transactionHash: keccak256(concatHex([id, requestId(blockNumber)])),
    transactionIndex: 0,
    logIndex,
  }
  return { id, log }
}

export type SentinelLogInput = {
  requestId: Hex
  sentinel: Address
  action: "committed" | "approved" | "denied"
  blockNumber: number
  logIndex?: number
  reason?: string
}

export function sentinelLog(input: SentinelLogInput): Log {
  const eventName = input.action === "committed" ? "Committed" : "Revealed"
  const topics = encodeEventTopics({
    abi: sentinelOracleAbi,
    eventName,
    args: { requestId: input.requestId, sentinel: input.sentinel },
  }) as Hex[]
  const data =
    input.action === "committed"
      ? encodeAbiParameters([{ type: "uint96" }], [800n])
      : encodeAbiParameters(
          [{ type: "bool" }, { type: "uint96" }, { type: "string" }],
          [input.action === "approved", 800n, input.reason ?? ""],
        )
  return {
    address: CONFIG.oracleAddress,
    topics,
    data,
    blockNumber: input.blockNumber,
    blockHash: requestId(input.blockNumber),
    transactionHash: keccak256(concatHex([input.requestId, input.sentinel, topics[0], requestId(input.blockNumber)])),
    transactionIndex: 0,
    logIndex: input.logIndex ?? 0,
  }
}

export type ArbitrationCaseFixture = { id: Hex; logs: Log[]; request: RequestFixture }

export function arbitrationCase(proposal: ProposalFixture = {}, block = 1): ArbitrationCaseFixture {
  const { id, log } = proposalLog(proposal, block)
  const approving: Address = "0x2222222222222222222222222222222222222222"
  const denying: Address = "0x3333333333333333333333333333333333333333"
  const revealBlock = block + COMMIT_WINDOW + 1
  return {
    id,
    logs: [
      log,
      sentinelLog({ requestId: id, sentinel: approving, action: "committed", blockNumber: block + 1 }),
      sentinelLog({ requestId: id, sentinel: denying, action: "committed", blockNumber: block + 2 }),
      sentinelLog({ requestId: id, sentinel: approving, action: "approved", blockNumber: revealBlock }),
      sentinelLog({
        requestId: id,
        sentinel: denying,
        action: "denied",
        reason: "R-4.1",
        blockNumber: revealBlock + 1,
      }),
      disputeLog("DisputeTriggered", id, revealBlock + 1, 1),
    ],
    request: {
      state: RequestState.FROZEN,
      commitDeadline: BigInt(block + COMMIT_WINDOW),
      approve: 1,
      deny: 1,
      deadline: 1000n,
    },
  }
}

type LogFilter = {
  address: Address
  fromBlock: number | Hex
  toBlock: number | Hex
  topics: (Hex | Hex[] | null)[]
}

function matchesFilter(log: Log, { address, fromBlock, toBlock, topics }: LogFilter) {
  return (
    log.address.toLowerCase() === address.toLowerCase() &&
    log.blockNumber >= Number(fromBlock) &&
    log.blockNumber <= Number(toBlock) &&
    topics.every((topic, i) => topic === null || [topic].flat().includes(log.topics[i] as Hex))
  )
}

function encodeRequest(fixture: RequestFixture) {
  const { approve = 0, deny = 0, sponsor = SAFE_INFO.safeAddress as Address } = fixture
  return encodeFunctionResult({
    abi: sentinelOracleAbi,
    functionName: "getRequest",
    result: {
      terms: {
        commitDeadline: fixture.commitDeadline ?? BigInt(1 + COMMIT_WINDOW),
        daoFeeShare: 0,
        revealDeadline: (fixture.commitDeadline ?? BigInt(1 + COMMIT_WINDOW)) + 20n,
        bondTarget: 0n,
        _padding: 0,
        sponsor,
        slashAmount: 0n,
      },
      progress: {
        state: fixture.state,
        fee: 0n,
        arbitrationDeadline: fixture.deadline ?? 0n,
        committedCount: fixture.committedCount ?? approve + deny,
        revealedCount: fixture.revealedCount ?? approve + deny,
        approveSentinelCount: approve,
        denySentinelCount: deny,
        _padding: 0,
      },
    },
  })
}

const GETTER_RESULTS = {
  ARBITRATOR: encodeFunctionResult({
    abi: sentinelOracleAbi,
    functionName: "ARBITRATOR",
    result: SAFE_INFO.safeAddress as Address,
  }),
  PROPOSER: encodeFunctionResult({ abi: sentinelOracleAbi, functionName: "PROPOSER", result: CONSENSUS }),
  COMMIT_WINDOW: encodeFunctionResult({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW", result: COMMIT_WINDOW }),
}

type CallTransaction = { data: Hex; from?: string; value?: string; to?: string }

function simulateRuling(tx: CallTransaction, request: RequestFixture | undefined): Hex {
  const validCaller = tx.from?.toLowerCase() === SAFE_INFO.safeAddress.toLowerCase()
  if (!validCaller || tx.value !== "0x0" || tx.to?.toLowerCase() !== CONFIG.oracleAddress.toLowerCase()) {
    throw new Error("Invalid ruling simulation caller, destination or value")
  }
  if (request?.state !== RequestState.FROZEN) throw new Error("Request is not frozen")
  return "0x"
}

export function mockOracleSdk(logs: Log[], requests: Record<Hex, RequestFixture>, latestBlock = 100) {
  const head = { number: latestBlock }
  const blockHashes = new Map<number, Hex>()
  const getBlockByNumber = vi.fn(async ([block]: [number | string] = ["latest"]) => {
    const number = block === "latest" ? head.number : Number(block)
    return { number, hash: blockHashes.get(number) ?? requestId(number) }
  })
  const getPastLogs = vi.fn(async ([filter]: [LogFilter]) => logs.filter((log) => matchesFilter(log, filter)))
  const call = vi.fn(async ([tx]: [CallTransaction, string?]) => {
    const decoded = decodeFunctionData({ abi: sentinelOracleAbi, data: tx.data })
    if (decoded.functionName in GETTER_RESULTS) {
      return GETTER_RESULTS[decoded.functionName as keyof typeof GETTER_RESULTS]
    }
    if (decoded.functionName === "resolveDispute" || decoded.functionName === "markOutOfScope") {
      return simulateRuling(tx, requests[decoded.args[0]])
    }
    if (decoded.functionName !== "getRequest") {
      throw new Error(`Unexpected call to ${decoded.functionName}`)
    }
    const fixture = requests[decoded.args[0]]
    if (!fixture) throw new Error(`Unknown request ${decoded.args[0]}`)
    return encodeRequest(fixture)
  })
  const send = vi.fn<SafeAppsSDK["txs"]["send"]>().mockResolvedValue({ safeTxHash: `0x${"ab".repeat(32)}` })
  const getInfo = vi.fn(async () => SAFE_INFO)
  const getChainInfo = vi.fn(async () => CHAIN_INFO)
  const sdk = {
    eth: { getBlockByNumber, getPastLogs, call },
    safe: { getInfo, getChainInfo },
    txs: { send },
  } as unknown as SafeAppsSDK
  return { sdk, getBlockByNumber, getPastLogs, call, send, getInfo, getChainInfo, head, blockHashes }
}
