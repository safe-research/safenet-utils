import { describe, expect, it } from "vitest"
import { parseConfig } from "../oracle"

describe("parseConfig", () => {
  it("defaults to the Gnosis Chain testnet oracle", () => {
    expect(parseConfig({})).toEqual({
      chainId: 100,
      oracleAddress: "0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0",
      logBlockRange: 10000,
    })
  })

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
      }),
    ).toEqual({
      chainId: 11155111,
      oracleAddress: "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD",
      logBlockRange: 500,
    })
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
