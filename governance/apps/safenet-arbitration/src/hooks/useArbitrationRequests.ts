import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import { fetchArbitrationRequests } from "@/lib/arbitrationRequests"

// Requests awaiting arbitration, searched one `logBlockRange` page at a time from the latest block backwards;
// `fetchNextPage` loads the next older page until genesis.
export function useArbitrationRequests(sdk: SafeAppsSDK, config: OracleConfig) {
  return useInfiniteQuery({
    queryKey: ["arbitrationRequests", config.chainId, config.oracleAddress, config.logBlockRange],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => fetchArbitrationRequests(sdk, config, pageParam),
    getNextPageParam: (lastPage) => (lastPage.fromBlock > 0 ? lastPage.fromBlock : undefined),
    select: (data) => ({
      requests: data.pages.flatMap((page) => page.requests),
      searchedFromBlock: data.pages[data.pages.length - 1].fromBlock,
    }),
  })
}
