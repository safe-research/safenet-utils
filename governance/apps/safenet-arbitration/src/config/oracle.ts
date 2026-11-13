import { type Address, getAddress, isAddress } from "viem"
import { type ZodType, z } from "zod"

export type OracleConfig = {
  chainId: number
  oracleAddress: Address
  logBlockRange: number
  // Base URL of the Safenet Explorer, which links Safe transactions to their Safenet checks.
  explorerUrl: string
  // JSON list of sentinel addresses and their names, to label sentinel votes.
  sentinelInfoUrl: string
}

// Vite reads a `VITE_X=` line in `.env` as `""`, which `.default()` doesn't cover and `z.coerce` would turn into `0`,
// so treat empty values as unset.
const emptyToDefault = <T>(schema: ZodType<T>, defaultVal?: unknown): ZodType<T> =>
  z.preprocess((val) => (val === undefined || val === "" ? defaultVal : val), schema)

// Only accepts correctly checksummed addresses, since viem's `isAddress` lets any all-lowercase address through.
const checkedAddressSchema = z
  .string()
  .refine((arg) => isAddress(arg, { strict: false }) && arg === getAddress(arg), "Invalid address format or checksum")
  .transform((arg) => arg as Address)

const chainIdSchema = z.coerce.number().int().positive()

// Only http(s) URLs, since the values are used as link targets and fetched.
const httpUrlSchema = z.url({ protocol: /^https?$/ })
// Without trailing slashes, so paths can be appended.
const baseUrlSchema = httpUrlSchema.transform((url) => url.replace(/\/+$/, ""))

// Defaults point at the Safenet production (Aegis Network, Gnosis Chain) `SentinelOracle`, the public Safenet Explorer
// and the sentinel list published in safe-fndn/safenet-data; keep in sync with `.env.sample`.
const envSchema = z.object({
  VITE_CHAIN_ID: emptyToDefault(chainIdSchema, "100"),
  VITE_SENTINEL_ORACLE_ADDRESS: emptyToDefault(checkedAddressSchema, "0x4F61B8832978e83b80D69551AEf07557DBE41d03"),
  VITE_LOG_BLOCK_RANGE: emptyToDefault(z.coerce.number().int().positive(), "10000"),
  VITE_SAFENET_EXPLORER_URL: emptyToDefault(baseUrlSchema, "https://safenet-explorer.eth.limo"),
  VITE_SENTINEL_INFO_URL: emptyToDefault(
    httpUrlSchema,
    "https://raw.githubusercontent.com/safe-fndn/safenet-data/main/assets/sentinel-info.json",
  ),
})

export function parseConfig(env: Record<string, unknown>): OracleConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    throw new Error(`Invalid app config:\n${z.prettifyError(result.error)}`)
  }
  return {
    chainId: result.data.VITE_CHAIN_ID,
    oracleAddress: result.data.VITE_SENTINEL_ORACLE_ADDRESS,
    logBlockRange: result.data.VITE_LOG_BLOCK_RANGE,
    explorerUrl: result.data.VITE_SAFENET_EXPLORER_URL,
    sentinelInfoUrl: result.data.VITE_SENTINEL_INFO_URL,
  }
}

export const config = parseConfig(import.meta.env)

// The part of the config that can be overridden at runtime from the settings dialog; empty values reset to the
// build-time config. Missing values do too, so overrides stored before a setting existed still parse.
export const oracleSettingsSchema = z.object({
  chainId: emptyToDefault(chainIdSchema, config.chainId),
  oracleAddress: emptyToDefault(checkedAddressSchema, config.oracleAddress),
  explorerUrl: emptyToDefault(baseUrlSchema, config.explorerUrl),
  sentinelInfoUrl: emptyToDefault(httpUrlSchema, config.sentinelInfoUrl),
})

export type OracleSettings = z.infer<typeof oracleSettingsSchema>
