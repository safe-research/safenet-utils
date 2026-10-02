import type { Log } from "@safe-global/safe-apps-sdk"
import {
  type Address,
  type DecodeEventLogReturnType,
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
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { ethCall, getLogs, type ReadRpc } from "@/lib/rpc"

type TransactionProposedArgs = DecodeEventLogReturnType<typeof consensusAbi, "TransactionProposed">["args"]

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

// EIP-712 `SafeTx` type of the Safe contracts, adapted from protocol `explorer/src/lib/safe/hashing.ts` at
// safe-research/safenet@9ff29ae549025b9f3ab4b5849597a2ac873ad329.
const SAFETX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const

// The hash the Safe contract at `transaction.safe` on `transaction.chainId` signs for `transaction`. The transaction's
// chain is its own, not the arbitration chain's.
export const calculateSafeTxHash = (transaction: SafeTransaction): Hex =>
  hashTypedData({
    domain: { chainId: transaction.chainId, verifyingContract: transaction.safe },
    types: SAFETX_TYPES,
    primaryType: "SafeTx",
    message: transaction,
  })

async function getProposer(rpc: ReadRpc, oracleAddress: Address) {
  const data = await ethCall(
    rpc,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "PROPOSER" }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "PROPOSER", data })
}

async function getCommitWindow(rpc: ReadRpc, oracleAddress: Address) {
  const data = await ethCall(
    rpc,
    oracleAddress,
    encodeFunctionData({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW" }),
  )
  return decodeFunctionResult({ abi: sentinelOracleAbi, functionName: "COMMIT_WINDOW", data })
}

// `SentinelOracle.postRequest` sets `commitDeadline` to the posting block plus `COMMIT_WINDOW`. A deadline that implies
// a block before the oracle existed (or beyond exact number precision) cannot belong to a real request.
function proposalBlock(commitDeadline: bigint, commitWindow: number, deploymentBlock: number): number {
  const block = commitDeadline - BigInt(commitWindow)
  if (block < BigInt(deploymentBlock) || block > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `Commit deadline ${commitDeadline} implies a proposal block outside the oracle's history from ${deploymentBlock}`,
    )
  }
  return Number(block)
}

function decodeProposal(log: Log) {
  try {
    return decodeEventLog({
      abi: consensusAbi,
      eventName: "TransactionProposed",
      topics: log.topics as ViemLog["topics"],
      data: log.data as Hex,
    }).args
  } catch (cause) {
    throw new Error(`Undecodable TransactionProposed log in transaction ${log.transactionHash}`, { cause })
  }
}

// Accepts only an event whose recomputed attestation message equals the request ID, so the proposal is the one the
// request was posted for. Once the ID matches, its transaction must also hash to the declared Safe transaction hash:
// the ID commits to that hash, not to the transaction bytes shown to the operator.
function findProposal(logs: Log[], consensus: Address, config: OracleConfig, requestId: Hex): RequestProposal | null {
  for (const log of logs) {
    const args = decodeProposal(log)
    if (args.oracle.toLowerCase() !== config.oracleAddress.toLowerCase()) {
      throw new Error(`TransactionProposed oracle outside the requested filter (${log.transactionHash})`)
    }
    // `Consensus` hashes with its own `block.chainid`, which is the oracle's chain as it calls the oracle directly.
    const id = oracleRequestId({
      chainId: config.chainId,
      consensus,
      epoch: args.epoch,
      oracle: config.oracleAddress,
      oracleData: args.oracleData,
      safeTxHash: args.safeTxHash,
    })
    if (id.toLowerCase() !== requestId.toLowerCase()) {
      continue
    }
    const safeTxHash = calculateSafeTxHash(args.transaction)
    if (safeTxHash.toLowerCase() !== args.safeTxHash.toLowerCase()) {
      throw new Error(
        `Proposal transaction hashes to ${safeTxHash}, not the declared ${args.safeTxHash} (${log.transactionHash})`,
      )
    }
    return {
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash as Hex,
      epoch: args.epoch,
      oracleData: args.oracleData,
      safeTxHash,
      transaction: args.transaction,
    }
  }
  return null
}

// Finds the proposal behind `request`, or `null` if no matching `TransactionProposed` event is found.
// `Consensus.proposeTransaction` (the oracle's `PROPOSER`) emits the event and posts the request in the same call, so
// the single block `commitDeadline - COMMIT_WINDOW` holds it. Provider and decoding failures reject rather than
// report "not found". Contract constants come from `rpc`; only the historical event comes from `logsRpc`, so a custom
// archive RPC can supply logs without becoming an authority on contract state.
export async function fetchRequestProposal(
  rpc: ReadRpc,
  config: OracleConfig,
  request: Pick<ArbitrationRequest, "requestId" | "commitDeadline">,
  logsRpc: ReadRpc = rpc,
): Promise<RequestProposal | null> {
  const [consensus, commitWindow] = await Promise.all([
    getProposer(rpc, config.oracleAddress),
    getCommitWindow(rpc, config.oracleAddress),
  ])
  const block = proposalBlock(request.commitDeadline, commitWindow, config.deploymentBlock)
  const logs = await getLogs(logsRpc, {
    address: consensus,
    fromBlock: block,
    toBlock: block,
    topics: encodeEventTopics({
      abi: consensusAbi,
      eventName: "TransactionProposed",
      args: { oracle: config.oracleAddress },
    }),
  })
  return findProposal(logs, consensus, config, request.requestId)
}
