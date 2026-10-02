import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import {
  type Address,
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  type Hex,
  hashTypedData,
  type Log as ViemLog,
} from "viem"
import type { OracleConfig } from "@/config/oracle"
import { consensusAbi } from "@/abi/consensusAbi"
import { sentinelOracleAbi } from "@/abi/sentinelOracleAbi"
import { type ArbitrationRequest, ethCall } from "@/lib/arbitrationRequests"

type TransactionProposedArgs = Extract<
  ReturnType<typeof decodeEventLog<typeof consensusAbi, "TransactionProposed">>,
  { eventName: "TransactionProposed" }
>["args"]

export type SafeTransaction = TransactionProposedArgs["transaction"]

// The `Consensus.proposeTransaction` call that posted an arbitration request to the oracle.
export type RequestProposal = {
  blockNumber: number
  transactionHash: Hex
  epoch: bigint
  oracleData: Hex
  safeTxHash: Hex
  transaction: SafeTransaction
}

export type OracleRequestIdParams = {
  chainId: number
  consensus: Address
  epoch: bigint
  oracle: Address
  oracleData: Hex
  safeTxHash: Hex
}

// Mirrors `ConsensusMessages.transactionProposal`. `Consensus.proposeTransaction` posts this attestation message to
// the oracle as the `requestId`, so recomputing it ties a `TransactionProposed` event to its request.
export const oracleRequestId = ({ chainId, consensus, epoch, oracle, oracleData, safeTxHash }: OracleRequestIdParams) =>
  hashTypedData({
    domain: { chainId, verifyingContract: consensus },
    types: {
      TransactionProposal: [
        { type: "uint64", name: "epoch" },
        { type: "address", name: "oracle" },
        { type: "bytes", name: "oracleData" },
        { type: "bytes32", name: "safeTxHash" },
      ],
    },
    primaryType: "TransactionProposal",
    message: { epoch, oracle, oracleData, safeTxHash },
  })

async function getProposer(sdk: SafeAppsSDK, oracleAddress: Address) {
  const data = await ethCall(
    sdk,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "PROPOSER" }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "PROPOSER", data })
}

async function getCommitWindow(sdk: SafeAppsSDK, oracleAddress: Address) {
  const data = await ethCall(
    sdk,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW" }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW", data })
}

// Finds the proposal behind `request`, or `null` if no matching `TransactionProposed` event is found.
// `Consensus.proposeTransaction` (the oracle's `PROPOSER`) emits the event and posts the request in the same call, and
// `SentinelOracle.postRequest` sets `commitDeadline` to that block plus `COMMIT_WINDOW`, so a single block holds the
// event. Only an event whose recomputed attestation message equals the request ID is accepted, so the returned
// proposal is the one the request was posted for.
export async function fetchRequestProposal(
  sdk: SafeAppsSDK,
  config: OracleConfig,
  request: Pick<ArbitrationRequest, "requestId" | "commitDeadline">,
): Promise<RequestProposal | null> {
  const [consensus, commitWindow] = await Promise.all([
    getProposer(sdk, config.oracleAddress),
    getCommitWindow(sdk, config.oracleAddress),
  ])
  const block = Number(request.commitDeadline) - commitWindow
  const logs = await sdk.eth.getPastLogs([
    {
      address: consensus,
      fromBlock: block,
      toBlock: block,
      topics: encodeEventTopics({
        abi: consensusAbi,
        eventName: "TransactionProposed",
        args: { oracle: config.oracleAddress },
      }),
    },
  ])
  for (const log of logs) {
    const { args } = decodeEventLog({
      abi: consensusAbi,
      eventName: "TransactionProposed",
      topics: log.topics as ViemLog["topics"],
      data: log.data as Hex,
    })
    // `Consensus` hashes with its own `block.chainid`, which is the oracle's chain as it calls the oracle directly.
    const id = oracleRequestId({
      chainId: config.chainId,
      consensus,
      epoch: args.epoch,
      oracle: config.oracleAddress,
      oracleData: args.oracleData,
      safeTxHash: args.safeTxHash,
    })
    if (id === request.requestId) {
      return {
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash as Hex,
        epoch: args.epoch,
        oracleData: args.oracleData,
        safeTxHash: args.safeTxHash,
        transaction: args.transaction,
      }
    }
  }
  return null
}
