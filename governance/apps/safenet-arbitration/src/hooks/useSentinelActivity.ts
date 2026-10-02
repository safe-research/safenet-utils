import { skipToken, useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"
import { fetchSentinelActivity, type SentinelActivityScope } from "@/lib/sentinelActivity"
import type { ReadSource } from "@/lib/rpc"

// The sentinel commitments and reveals of one request, from its creation to its freezing. Searching starts once `scope`
// is known. Events in blocks at or before the freeze never change, so a successful read is kept for the lifetime of the
// query cache; `generation` discards it if the chain history it was read from was replaced.
export function useSentinelActivity(
  source: ReadSource,
  config: OracleConfig,
  scope: SentinelActivityScope | undefined,
  generation: number,
) {
  return useQuery({
    queryKey: [
      "sentinelActivity",
      config.chainId,
      config.oracleAddress.toLowerCase(),
      scope?.requestId.toLowerCase() ?? "",
      scope?.fromBlock ?? null,
      scope?.toBlock ?? null,
      generation,
      source.key,
    ],
    queryFn: scope ? () => fetchSentinelActivity(source.rpc, config, scope) : skipToken,
    retry: false,
    staleTime: Infinity,
  })
}
