/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string
  readonly VITE_SENTINEL_ORACLE_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
