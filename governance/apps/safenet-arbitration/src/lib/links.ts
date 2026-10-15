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

// The Charter version SafeDAO last approved, rather than the possibly unapproved draft on `main`.
const CHARTER_URL =
  "https://github.com/safe-research/safenet-charter/blob/latest-safedao-approved/Safenet_Arbitration_Charter.md"

// The Charter's rules, keyed by the identifier a denying sentinel gives as its vote reason (Charter § 2.14), with the
// anchor GitHub generates for the rule's heading. The Charter defines no stable anchors, so these follow its headings.
const CHARTER_RULES: Record<string, { title: string; anchor: string }> = {
  "R-4.0": { title: "Network and Safe validity", anchor: "r-40--network-and-safe-validity" },
  "R-4.1": { title: "Settings-change blocking", anchor: "r-41--settings-change-blocking" },
  "R-4.2": { title: "Delegatecall integrity", anchor: "r-42--delegatecall-integrity" },
  "R-4.3": { title: "Value-target manipulation", anchor: "r-43--value-target-manipulation" },
  "R-4.4": {
    title: "Authorization-target manipulation: wrong target",
    anchor: "r-44--authorization-target-manipulation-wrong-target",
  },
  "R-4.5": {
    title: "Authorization-target manipulation: excessive approval amount",
    anchor: "r-45--authorization-target-manipulation-excessive-approval-amount",
  },
  "R-4.6": { title: "Known malicious or compromised target", anchor: "r-46--known-malicious-or-compromised-target" },
}

export type CharterLink = { url: string; title: string }

// Where a sentinel's vote reason points in the Charter: the cited rule, or the Charter as a whole for a reason that
// is not a known rule identifier (the protocol accepts arbitrary strings). An empty reason has no link.
export function charterReasonLink(reason: string): CharterLink | undefined {
  const id = reason.trim().toUpperCase()
  if (id === "") {
    return undefined
  }
  const rule = CHARTER_RULES[id]
  if (!rule) {
    return { url: CHARTER_URL, title: "Safenet Arbitration Charter" }
  }
  return { url: `${CHARTER_URL}#${rule.anchor}`, title: `${id} — ${rule.title}` }
}
