import { describe, expect, it } from "vitest"
import { parseConfig } from "../oracle"

describe("parseConfig", () => {
  it("treats empty values as unset", () => {
    expect(parseConfig({ VITE_CHAIN_ID: "", VITE_SENTINEL_ORACLE_ADDRESS: "", VITE_LOG_BLOCK_RANGE: "" })).toEqual(
      parseConfig({}),
    )
  })

  it("applies overrides", () => {
    expect(
      parseConfig({
        VITE_CHAIN_ID: "11155111",
        VITE_SENTINEL_ORACLE_ADDRESS: "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD",
        VITE_LOG_BLOCK_RANGE: "500",
        VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: "42",
      }),
    ).toEqual({
      chainId: 11155111,
      oracleAddress: "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD",
      logBlockRange: 500,
      deploymentBlock: 42,
    })
  })

  it.each([{ VITE_CHAIN_ID: "1" }, { VITE_SENTINEL_ORACLE_ADDRESS: "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" }])(
    "requires a deployment bound for a custom target",
    (target) => {
      expect(() => parseConfig(target)).toThrow("VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK")
      expect(() => parseConfig({ ...target, VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: "" })).toThrow(
        "VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK",
      )
      expect(parseConfig({ ...target, VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: "0" }).deploymentBlock).toBe(0)
    },
  )

  it.each(["-1", "1.5", "9007199254740992", "invalid"])("rejects an invalid deployment bound: %s", (value) => {
    expect(() => parseConfig({ VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: value })).toThrow(
      "VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK",
    )
  })

  it("rejects invalid values", () => {
    expect(() => parseConfig({ VITE_CHAIN_ID: "gnosis" })).toThrow("VITE_CHAIN_ID")
    expect(() => parseConfig({ VITE_CHAIN_ID: "1.5" })).toThrow("VITE_CHAIN_ID")
    expect(() => parseConfig({ VITE_LOG_BLOCK_RANGE: "0" })).toThrow("VITE_LOG_BLOCK_RANGE")
    expect(() => parseConfig({ VITE_SENTINEL_ORACLE_ADDRESS: "0x1234" })).toThrow("VITE_SENTINEL_ORACLE_ADDRESS")
    // Addresses must be checksummed, so a typo can't slip through as an all-lowercase address.
    expect(() => parseConfig({ VITE_SENTINEL_ORACLE_ADDRESS: "0x544f12bad6ff72564abbc7ea6494a2a4bdd0ddd0" })).toThrow(
      "VITE_SENTINEL_ORACLE_ADDRESS",
    )
    expect(() => parseConfig({ VITE_SENTINEL_ORACLE_ADDRESS: "0x544f12bAd6FF72564abBc7eA6494A2a4BdD0DDD0" })).toThrow(
      "VITE_SENTINEL_ORACLE_ADDRESS",
    )
  })
})
