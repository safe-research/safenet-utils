import { useQuery } from "@tanstack/react-query"
import { fetchSentinelLabels } from "@/lib/sentinelInfo"

// Sentinel names from the configured sentinel list, fetched once per URL and session.
export function useSentinelLabels(url: string) {
  return useQuery({
    queryKey: ["sentinelLabels", url],
    queryFn: () => fetchSentinelLabels(url),
    staleTime: Infinity,
  })
}
