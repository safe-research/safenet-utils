import { describe, expect, it } from "vitest"
import { charterReasonLink, safenetExplorerTxUrl } from "@/lib/links"

const CHARTER_URL =
  "https://github.com/safe-research/safenet-charter/blob/latest-safedao-approved/Safenet_Arbitration_Charter.md"

describe("charterReasonLink", () => {
  it("links a rule identifier to its section of the Charter", () => {
    expect(charterReasonLink("R-4.3")).toEqual({
      url: `${CHARTER_URL}#r-43--value-target-manipulation`,
      title: "R-4.3 — Value-target manipulation",
    })
  })

  it("tolerates case and surrounding whitespace in the rule identifier", () => {
    expect(charterReasonLink(" r-4.5\n")).toEqual(charterReasonLink("R-4.5"))
  })

  it("links every rule from R-4.0 to R-4.6 to a section", () => {
    for (let i = 0; i <= 6; i++) {
      expect(charterReasonLink(`R-4.${i}`)?.url).toMatch(new RegExp(`^${CHARTER_URL}#r-4${i}--`))
    }
  })

  it("links any other reason to the Charter as a whole", () => {
    expect(charterReasonLink("R-4.7")).toEqual({ url: CHARTER_URL, title: "Safenet Arbitration Charter" })
    expect(charterReasonLink("looks like a phishing attempt")?.url).toBe(CHARTER_URL)
  })

  it("has no link for an empty reason", () => {
    expect(charterReasonLink("")).toBeUndefined()
    expect(charterReasonLink("  ")).toBeUndefined()
  })
})

describe("safenetExplorerTxUrl", () => {
  const safeTxHash = "0xa545dcfc96b8f12f1d602fd2cc228f946cdaa0fa899f9811281476855c017b9c"

  it("links the Safe transaction on its chain", () => {
    expect(safenetExplorerTxUrl("https://safenet-explorer.eth.limo", 1n, safeTxHash)).toBe(
      `https://safenet-explorer.eth.limo/#/safeTx?safeTxHash=${safeTxHash}&chainId=1`,
    )
  })

  it("keeps an explorer served from a path", () => {
    expect(safenetExplorerTxUrl("https://safe.dev/safenet/", 100, safeTxHash)).toBe(
      `https://safe.dev/safenet/#/safeTx?safeTxHash=${safeTxHash}&chainId=100`,
    )
  })
})
