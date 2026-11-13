import { type Address, getAddress, isAddress } from "viem"
import { z } from "zod"

// An entry of the sentinel list (e.g. safe-fndn/safenet-data's `sentinel-info.json`). Only the fields used here are
// checked; any others are ignored.
const sentinelSchema = z.object({
  address: z.string().refine((arg) => isAddress(arg, { strict: false }), "Invalid address"),
  label: z.string(),
})

// Sentinel names keyed by checksummed address. Entries that don't parse are skipped, so one malformed entry doesn't
// hide every other name.
export async function fetchSentinelLabels(url: string): Promise<Map<Address, string>> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const entries = z.array(z.unknown()).parse(await response.json())
  const labels = new Map<Address, string>()
  for (const entry of entries) {
    const result = sentinelSchema.safeParse(entry)
    if (result.success && result.data.label.trim() !== "") {
      labels.set(getAddress(result.data.address), result.data.label.trim())
    }
  }
  return labels
}
