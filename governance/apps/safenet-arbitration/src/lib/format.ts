export function shorten(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}

// Keeps the `0x` prefix and first and last 3 bytes, for hashes whose full value is only of interest when copied.
export function shortenHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

// Keeps the `0x` prefix and the first `bytes` bytes of long hex data.
export function truncateHex(hex: string, bytes: number): string {
  const length = 2 + bytes * 2
  return hex.length > length ? `${hex.slice(0, length)}…` : hex
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

// How far a Unix timestamp is from `now` (also Unix seconds), in its largest whole unit, e.g. "in 2 days" or
// "3 hours ago". Anything under a minute counts as minutes.
export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = timestamp - now
  const [unit, size] = RELATIVE_UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? RELATIVE_UNITS[2]
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.trunc(seconds / size), unit)
}

// A Unix timestamp as local date and time, e.g. "13 Nov 2026, 11:14".
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
