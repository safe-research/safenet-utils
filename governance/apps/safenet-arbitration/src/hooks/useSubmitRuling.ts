import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useMutation } from "@tanstack/react-query"
import type { Hex } from "viem"
import type { OracleConfig } from "@/config/oracle"
import { type Ruling, submitRuling } from "@/lib/rulings"

// Queues a ruling on the configured oracle as a Safe transaction. Execution is left to Safe{Wallet}, so success only
// means the transaction was proposed.
export function useSubmitRuling(sdk: SafeAppsSDK, config: OracleConfig) {
  return useMutation({
    mutationFn: ({ requestId, ruling, context }: { requestId: Hex; ruling: Ruling; context: string }) =>
      submitRuling(sdk, config.oracleAddress, requestId, ruling, context),
  })
}
