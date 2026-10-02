import { parseAbi } from "viem"

// Hand-written subset of the `Consensus` ABI, copied from safe-research/safenet@0be96367486a9fbd804c702b255fecfb3adbdcb3
// (`contracts/src/interfaces/IConsensus.sol`, `SafeTransaction.T` from `contracts/src/libraries/SafeTransaction.sol`).
export const consensusAbi = parseAbi([
  "struct SafeTransaction { uint256 chainId; address safe; address to; uint256 value; bytes data; uint8 operation; uint256 safeTxGas; uint256 baseGas; uint256 gasPrice; address gasToken; address refundReceiver; uint256 nonce; }",
  "event TransactionProposed(bytes32 indexed safeTxHash, bytes32 indexed safeId, address indexed oracle, uint64 epoch, bytes oracleData, SafeTransaction transaction)",
])
