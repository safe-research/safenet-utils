/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string
  readonly VITE_SENTINEL_ORACLE_ADDRESS?: string
  readonly VITE_LOG_BLOCK_RANGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
