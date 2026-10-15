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
