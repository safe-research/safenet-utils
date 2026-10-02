import { parseAbi } from "viem"

// Hand-written subset of the `SentinelOracle` ABI, copied from safe-research/safenet@0be96367486a9fbd804c702b255fecfb3adbdcb3
// (`contracts/src/SentinelOracle.sol`, structs from `contracts/src/libraries/SentinelOracleRequests.sol`). The
// `_padding` members are part of the returned structs, so they must stay for `getRequest` to decode.
export const sentinelOracleAbi = parseAbi([
  "struct Terms { uint64 commitDeadline; uint24 daoFeeShare; uint64 revealDeadline; uint96 bondTarget; uint8 _padding; address sponsor; uint96 slashAmount; }",
  "struct Progress { uint8 state; uint96 fee; uint64 arbitrationDeadline; uint16 committedCount; uint16 revealedCount; uint16 approveSentinelCount; uint16 denySentinelCount; uint24 _padding; }",
  "struct Request { Terms terms; Progress progress; }",
  "function getRequest(bytes32 requestId) view returns (Request)",
  "function PROPOSER() view returns (address)",
  "function COMMIT_WINDOW() view returns (uint32)",
  "function resolveDispute(bytes32 requestId, bool approveWins, string context)",
  "function markOutOfScope(bytes32 requestId, string context)",
  "event DisputeTriggered(bytes32 indexed requestId, uint64 deadline)",
  "event DisputeResolved(bytes32 indexed requestId, uint8 outcome, uint128 slashed, string context)",
  "event DisputeOutOfScope(bytes32 indexed requestId, string context)",
  "event ArbitrationTimedOut(bytes32 indexed requestId)",
])

// `SentinelOracleRequest.State`.
export const RequestState = {
  NONE: 0,
  PENDING: 1,
  FROZEN: 2,
  RESOLVED_APPROVED: 3,
  RESOLVED_DENIED: 4,
  TIMED_OUT: 5,
} as const
