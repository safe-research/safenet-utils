import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import { getArbitrator } from "@/lib/rulings"

// The oracle's `ARBITRATOR`, read once per oracle and connected Safe. It is immutable on-chain, so it is kept for the
// lifetime of the query cache. Only read for a Safe connected on the configured chain, whose RPC the SDK serves.
export function useArbitrator(sdk: SafeAppsSDK, config: OracleConfig, safe: SafeInfo | undefined) {
  return useQuery({
    queryKey: ["arbitrator", config.chainId, config.oracleAddress.toLowerCase(), safe?.safeAddress.toLowerCase() ?? ""],
    queryFn: () => getArbitrator(sdk, config.oracleAddress),
    enabled: safe !== undefined && safe.chainId === config.chainId,
    retry: false,
    staleTime: Infinity,
  })
}
