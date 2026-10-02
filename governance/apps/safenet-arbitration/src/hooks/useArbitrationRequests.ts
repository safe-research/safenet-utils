import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { OracleConfig } from "@/config/oracle"
import { type ArbitrationRequestsSnapshot, fetchArbitrationRequests } from "@/lib/arbitrationRequests"
import type { ReadSource } from "@/lib/rpc"

const REFRESH_INTERVAL_MS = 30_000
const BACKFILL_DELAY_MS = 400

// Dispute events were searched throughout the selected block window.
export function isSearchComplete({ historyToBlock, liveThroughBlock, observedBlock }: ArbitrationRequestsSnapshot) {
  return historyToBlock === null && liveThroughBlock >= observedBlock
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}

// Same definition of "visible" as the query client's focus handling that drives interval and focus refreshes.
function isDocumentVisible() {
  return document.visibilityState !== "hidden"
}

// The requests awaiting arbitration, kept in one query that owns every read: the first load, the catch-up through
// older and newer blocks, the 30-second polling and manual refreshes. Each read extends the previous successful
// snapshot of this same query, so a failed read leaves the last good one in place for the list to mark as stale.
export function useArbitrationRequests(
  sdk: SafeAppsSDK,
  source: ReadSource,
  config: OracleConfig,
  safeAddress: string,
  lookbackBlocks: number | null,
) {
  const visible = useSyncExternalStore(subscribeToVisibility, isDocumentVisible)
  const { data, error, isPending, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: [
      "arbitrationRequests",
      config.chainId,
      config.oracleAddress.toLowerCase(),
      config.deploymentBlock,
      config.logBlockRange,
      safeAddress.toLowerCase(),
      source.key,
      lookbackBlocks,
    ],
    queryFn: ({ client, queryKey, signal }) =>
      fetchArbitrationRequests(sdk, config, {
        previous: client.getQueryData<ArbitrationRequestsSnapshot>(queryKey),
        signal,
        lookbackBlocks,
        logsRpc: source.rpc,
      }),
    retry: false,
    // Hidden pages skip the interval ticks. A failed read stops them until Retry, or a return to the page, reads again.
    refetchInterval: (query) => (query.state.status === "error" ? false : REFRESH_INTERVAL_MS),
    refetchOnWindowFocus: "always",
  })
  const refresh = useCallback(() => void refetch({ cancelRefetch: false }), [refetch])
  const catchingUp = data !== undefined && !isSearchComplete(data)

  // Pace history pages so an empty range cannot flood the Wallet RPC. Hidden pages, errors and unmounts cancel
  // continuation. `dataUpdatedAt` re-arms it even if a whole read happened between two renders.
  useEffect(() => {
    if (!catchingUp || isFetching || error || !visible) {
      return
    }
    const timer = window.setTimeout(refresh, BACKFILL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [catchingUp, isFetching, error, visible, dataUpdatedAt, refresh])

  return { data, error, isPending, isFetching, refresh }
}
