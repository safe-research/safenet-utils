import { describe, expect, it } from "vitest"
import { formatRelativeTime } from "@/lib/format"

const NOW = 1_700_000_000
const relative = (unit: Intl.RelativeTimeFormatUnit, value: number) =>
  new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit)

describe("formatRelativeTime", () => {
  it("uses the largest whole unit", () => {
    expect(formatRelativeTime(NOW + 2 * 86_400 + 3_600, NOW)).toBe(relative("day", 2))
    expect(formatRelativeTime(NOW + 5 * 3_600, NOW)).toBe(relative("hour", 5))
    expect(formatRelativeTime(NOW + 90, NOW)).toBe(relative("minute", 1))
  })

  it("formats past times", () => {
    expect(formatRelativeTime(NOW - 3 * 3_600, NOW)).toBe(relative("hour", -3))
  })

  it("counts anything under a minute as minutes", () => {
    expect(formatRelativeTime(NOW + 10, NOW)).toBe(relative("minute", 0))
  })
})
