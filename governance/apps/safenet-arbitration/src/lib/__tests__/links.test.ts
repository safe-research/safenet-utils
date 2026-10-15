import { describe, expect, it } from "vitest"
import { charterReasonLink } from "@/lib/links"

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
