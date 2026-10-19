import { describe, expect, it } from "vitest"
import { blockies } from "@/lib/blockies"

const ADDRESS = "0xB83c4b66e752D947c1F55fd703b7937e21e401E4"

describe("blockies", () => {
  it("matches the reference blockies implementation", () => {
    // Generated with the `blo` package (v2.1.1), the blockies port Safe{Wallet} uses.
    const { size, cells, background, color, spot } = blockies(ADDRESS)
    expect(size).toBe(8)
    // prettier-ignore
    expect(cells).toEqual([
      2, 0, 1, 0, 0, 1, 0, 2,
      2, 1, 1, 1, 1, 1, 1, 2,
      1, 1, 1, 1, 1, 1, 1, 1,
      1, 0, 0, 1, 1, 0, 0, 1,
      1, 0, 2, 0, 0, 2, 0, 1,
      0, 1, 0, 1, 1, 0, 1, 0,
      0, 1, 0, 2, 2, 0, 1, 0,
      0, 1, 1, 1, 1, 1, 1, 0,
    ])
    expect(background).toEqual({ hue: 348, saturation: expect.closeTo(49.841), lightness: expect.closeTo(52.345) })
    expect(color).toEqual({ hue: 16, saturation: expect.closeTo(51.324), lightness: expect.closeTo(47.478) })
    expect(spot).toEqual({ hue: 352, saturation: expect.closeTo(41.843), lightness: expect.closeTo(61.243) })
  })

  it("ignores the address checksum casing", () => {
    expect(blockies(ADDRESS.toLowerCase())).toEqual(blockies(ADDRESS))
  })

  it("differs between addresses", () => {
    expect(blockies("0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0")).not.toEqual(blockies(ADDRESS))
  })
})
