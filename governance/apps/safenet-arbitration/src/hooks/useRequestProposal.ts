import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { fetchRequestProposal } from "@/lib/requestProposal"

// The proposal behind an arbitration request, loaded when its details are first shown. A proposal never changes once
// posted, so it is kept for the lifetime of the query cache.
export function useRequestProposal(sdk: SafeAppsSDK, config: OracleConfig, request: ArbitrationRequest) {
  return useQuery({
    queryKey: ["requestProposal", config.chainId, config.oracleAddress, request.requestId],
    queryFn: () => fetchRequestProposal(sdk, config, request),
    staleTime: Infinity,
  })
}
