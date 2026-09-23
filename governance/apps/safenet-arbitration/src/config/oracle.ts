import { type Address, getAddress, isAddress } from "viem"
import { type ZodType, z } from "zod"

export type OracleConfig = {
  chainId: number
  oracleAddress: Address
  logBlockRange: number
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

// Defaults point at the current Gnosis Chain testnet `SentinelOracle`; keep in sync with `.env.sample`.
const envSchema = z.object({
  VITE_CHAIN_ID: emptyToDefault(z.coerce.number().int().nonnegative(), "100"),
  VITE_SENTINEL_ORACLE_ADDRESS: emptyToDefault(checkedAddressSchema, "0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0"),
  VITE_LOG_BLOCK_RANGE: emptyToDefault(z.coerce.number().int().positive(), "10000"),
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
  }
}

export const config = parseConfig(import.meta.env)
