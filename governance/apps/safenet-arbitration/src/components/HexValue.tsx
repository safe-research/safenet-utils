import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline"
import { type SyntheticEvent, useEffect, useState } from "react"
import type { Address, Hex } from "viem"
import { ExternalLink } from "@/components/ExternalLink"
import { type ChainId, explorerAddressUrl, explorerTxUrl, safeWalletTxUrl, safeWalletUrl } from "@/lib/links"
import { copyToClipboard } from "@/lib/clipboard"
import { shortenHash } from "@/lib/format"

const COPIED_FEEDBACK_MS = 1500

// Values sit inside clickable table rows, so copying them must not toggle the row.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await copyToClipboard(value)
      setCopied(true)
    } catch (error) {
      console.warn("Failed to copy to clipboard", error)
    }
  }

  const Icon = copied ? CheckIcon : ClipboardDocumentIcon
  return (
    <button
      type="button"
      onClick={(event) => {
        stopPropagation(event)
        copy()
      }}
      onKeyDown={stopPropagation}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      title={copied ? "Copied" : "Copy to clipboard"}
      className="ml-1 inline-flex rounded p-0.5 align-middle text-muted-foreground hover:bg-selected hover:text-foreground"
    >
      <Icon aria-hidden="true" className={`size-4 ${copied ? "text-success" : ""}`} />
    </button>
  )
}

// An address, hash or other hex value, shown as `display` (e.g. shortened) and linked to `href` if given. The copy
// button always copies the full `value`.
export function HexValue({
  value,
  display = value,
  href,
  title,
}: {
  value: string
  display?: string
  href?: string
  title?: string
}) {
  return (
    <span className="font-mono break-all">
      <ExternalLink href={href} title={title}>
        {display}
      </ExternalLink>
      <CopyButton value={value} />
    </span>
  )
}

// An address on `chainId`, linked to the block explorer.
export function AddressValue({
  chainId,
  address,
  display,
  title,
}: {
  chainId: ChainId
  address: Address
  display?: string
  title?: string
}) {
  return <HexValue value={address} display={display} href={explorerAddressUrl(chainId, address)} title={title} />
}

// A Safe on `chainId`, linked to its overview in Safe{Wallet}.
export function SafeValue({ chainId, safe }: { chainId: ChainId; safe: Address }) {
  return <HexValue value={safe} href={safeWalletUrl(chainId, safe)} />
}

// A Safe transaction hash, linked to the transaction in Safe{Wallet}.
export function SafeTxHashValue({ chainId, safe, safeTxHash }: { chainId: ChainId; safe: Address; safeTxHash: Hex }) {
  return <HexValue value={safeTxHash} href={safeWalletTxUrl(chainId, safe, safeTxHash)} />
}

// A transaction hash on `chainId`, shortened and linked to the block explorer.
export function TxHashValue({ chainId, hash }: { chainId: ChainId; hash: Hex }) {
  return <HexValue value={hash} display={shortenHash(hash)} href={explorerTxUrl(chainId, hash)} title={hash} />
}
