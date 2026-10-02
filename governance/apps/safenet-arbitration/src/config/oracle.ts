import { type Address, getAddress, isAddress } from "viem"
import { type ZodType, z } from "zod"

export type OracleConfig = {
  chainId: number
  oracleAddress: Address
  deploymentBlock: number
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

const DEFAULT_ORACLE = "0x544F12bAd6FF72564abBc7eA6494A2a4BdD0DDD0"
const DEFAULT_DEPLOYMENT_BLOCK = 48_280_806

const envSchema = z.object({
  VITE_CHAIN_ID: emptyToDefault(z.coerce.number().int().nonnegative(), "100"),
  VITE_SENTINEL_ORACLE_ADDRESS: emptyToDefault(checkedAddressSchema, DEFAULT_ORACLE),
  VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK: emptyToDefault(z.coerce.number().int().nonnegative().optional()),
  VITE_LOG_BLOCK_RANGE: emptyToDefault(z.coerce.number().int().positive(), "10000"),
})

export function parseConfig(env: Record<string, unknown>): OracleConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    throw new Error(`Invalid app config:\n${z.prettifyError(result.error)}`)
  }
  const deploymentBlock = result.data.VITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK
  const defaultDeployment =
    result.data.VITE_CHAIN_ID === 100 && result.data.VITE_SENTINEL_ORACLE_ADDRESS === DEFAULT_ORACLE
  if (deploymentBlock === undefined && !defaultDeployment) {
    throw new Error(
      "Invalid app config:\nVITE_SENTINEL_ORACLE_DEPLOYMENT_BLOCK is required for a custom chain or oracle",
    )
  }
  return {
    chainId: result.data.VITE_CHAIN_ID,
    oracleAddress: result.data.VITE_SENTINEL_ORACLE_ADDRESS,
    deploymentBlock: deploymentBlock ?? DEFAULT_DEPLOYMENT_BLOCK,
    logBlockRange: result.data.VITE_LOG_BLOCK_RANGE,
  }
}

export const config = parseConfig(import.meta.env)
