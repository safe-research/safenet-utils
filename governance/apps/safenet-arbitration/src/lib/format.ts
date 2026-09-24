export function shorten(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}
