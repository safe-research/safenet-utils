import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { fetchRequestVotes } from "@/lib/requestVotes"

// The sentinel votes on an arbitration request, loaded when its details are first shown. A request is only frozen for
// arbitration once every committed sentinel revealed or its reveal window closed, so its votes never change and are
// kept for the lifetime of the query cache.
export function useRequestVotes(sdk: SafeAppsSDK, config: OracleConfig, request: ArbitrationRequest) {
  return useQuery({
    queryKey: ["requestVotes", config.chainId, config.oracleAddress, request.requestId],
    queryFn: () => fetchRequestVotes(sdk, config, request),
    staleTime: Infinity,
  })
}
