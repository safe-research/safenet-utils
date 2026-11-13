import { type Address, getAddress, isAddress } from "viem"
import { z } from "zod"

// An entry of the sentinel list (e.g. safe-fndn/safenet-data's `sentinel-info.json`), with its address checksummed.
// Only the fields used here are checked; any others are ignored.
const sentinelSchema = z.object({
  address: z
    .string()
    .refine((arg) => isAddress(arg, { strict: false }), "Invalid address")
    .transform((arg) => getAddress(arg)),
  label: z.string().trim().min(1),
})

// Sentinel names keyed by checksummed address. Entries that don't parse are skipped, so one malformed entry doesn't
// hide every other name.
const sentinelListSchema = z
  .array(sentinelSchema.nullable().catch(null))
  .transform(
    (entries) =>
      new Map<Address, string>(entries.flatMap((entry) => (entry === null ? [] : [[entry.address, entry.label]]))),
  )

export async function fetchSentinelLabels(url: string): Promise<Map<Address, string>> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return sentinelListSchema.parse(await response.json())
}
