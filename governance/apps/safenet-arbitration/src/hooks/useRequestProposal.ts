import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import type { ArbitrationRequest } from "@/lib/arbitrationRequests"
import { fetchRequestProposal } from "@/lib/requestProposal"
import type { ReadSource } from "@/lib/rpc"

// The verified proposal behind an arbitration request, loaded when its details are first shown. A proposal never
// changes once posted, so a result is kept for the lifetime of the query cache and never refetched by list polling.
// `generation` scopes it to the observed chain history: a reorg reset starts a fresh lookup. Failures and a missing
// proposal are not retried automatically; the caller offers an explicit retry through `refetch`.
export function useRequestProposal(
  sdk: SafeAppsSDK,
  source: ReadSource,
  config: OracleConfig,
  request: Pick<ArbitrationRequest, "requestId" | "commitDeadline">,
  generation: number,
) {
  return useQuery({
    queryKey: [
      "requestProposal",
      config.chainId,
      config.oracleAddress.toLowerCase(),
      request.requestId.toLowerCase(),
      request.commitDeadline.toString(),
      generation,
      source.key,
    ],
    queryFn: () => fetchRequestProposal(sdk, config, request, source.rpc),
    retry: false,
    staleTime: Infinity,
  })
}
