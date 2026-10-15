import type { Address, Hex } from "viem"

const SAFE_WALLET_URL = "https://app.safe.global"

type LinkTargets = {
  // EIP-3770 short name, which Safe{Wallet} uses to prefix Safe addresses in its URLs.
  shortName: string
  // Base URL of an Etherscan or Blockscout compatible explorer, which share the `/address`, `/tx` and `/block` paths.
  explorerUrl: string
}

// Link targets per chain ID. Values on any other chain are still shown and copyable, just without a link.
const LINK_TARGETS: Record<string, LinkTargets> = {
  "1": { shortName: "eth", explorerUrl: "https://etherscan.io" },
  "100": { shortName: "gno", explorerUrl: "https://gnosisscan.io" },
  "10200": { shortName: "chi", explorerUrl: "https://gnosis-chiado.blockscout.com" },
  "42161": { shortName: "arb1", explorerUrl: "https://arbiscan.io" },
  "11155111": { shortName: "sep", explorerUrl: "https://sepolia.etherscan.io" },
}

// Safe transactions carry their chain ID as a `uint256`, so accept both representations.
export type ChainId = number | bigint

const linkTargets = (chainId: ChainId): LinkTargets | undefined => LINK_TARGETS[chainId.toString()]

export function explorerAddressUrl(chainId: ChainId, address: Address): string | undefined {
  const targets = linkTargets(chainId)
  return targets && `${targets.explorerUrl}/address/${address}`
}

export function explorerTxUrl(chainId: ChainId, hash: Hex): string | undefined {
  const targets = linkTargets(chainId)
  return targets && `${targets.explorerUrl}/tx/${hash}`
}

export function explorerBlockUrl(chainId: ChainId, blockNumber: number | bigint): string | undefined {
  const targets = linkTargets(chainId)
  return targets && `${targets.explorerUrl}/block/${blockNumber}`
}

// The Safe's overview page in Safe{Wallet}.
export function safeWalletUrl(chainId: ChainId, safe: Address): string | undefined {
  const targets = linkTargets(chainId)
  return targets && `${SAFE_WALLET_URL}/home?safe=${targets.shortName}:${safe}`
}

// The Safe transaction's page in Safe{Wallet}. It only resolves if the transaction was shared with the Safe
// Transaction Service, as Safe{Wallet} looks it up there.
export function safeWalletTxUrl(chainId: ChainId, safe: Address, safeTxHash: Hex): string | undefined {
  const targets = linkTargets(chainId)
  return (
    targets && `${SAFE_WALLET_URL}/transactions/tx?safe=${targets.shortName}:${safe}&id=multisig_${safe}_${safeTxHash}`
  )
}
