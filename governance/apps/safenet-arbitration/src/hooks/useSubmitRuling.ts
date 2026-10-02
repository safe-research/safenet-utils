import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useMutation } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import { type SubmitRulingInput, submitRuling } from "@/lib/rulings"

// Shared by every consumer that reacts to a ruling being prepared, so a pending proposal for one oracle is seen by
// all of them.
export function rulingMutationKey(config: OracleConfig) {
  return ["ruling", config.chainId, config.oracleAddress.toLowerCase()] as const
}

// Queues a ruling on the configured oracle as a Safe transaction. Execution is left to Safe{Wallet}, so success only
// means the transaction was proposed. A failed attempt is never retried automatically: whether to propose again is for
// the operator to decide after the checks ran afresh.
export function useSubmitRuling(sdk: SafeAppsSDK, config: OracleConfig) {
  return useMutation({
    mutationKey: rulingMutationKey(config),
    mutationFn: (input: SubmitRulingInput) => submitRuling(sdk, config, input),
    retry: false,
  })
}
