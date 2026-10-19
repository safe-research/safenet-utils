import type { Address } from "viem"
import { ExternalLink } from "@/components/ExternalLink"
import { blockies, hslCss } from "@/lib/blockies"
import { type ChainId, explorerAddressUrl } from "@/lib/links"
import { shorten } from "@/lib/format"

// The address's blockies identicon, drawn as one square per non-background cell.
function Identicon({ address }: { address: Address }) {
  const { size, cells, background, color, spot } = blockies(address)
  const fills = [undefined, hslCss(color), hslCss(spot)]
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="size-5 shrink-0 rounded-full"
    >
      <rect width={size} height={size} fill={hslCss(background)} />
      {cells.map((cell, i) =>
        cell === 0 ? null : (
          <rect key={i} x={i % size} y={Math.floor(i / size)} width={1} height={1} fill={fills[cell]} />
        ),
      )}
    </svg>
  )
}

// A compact address on `chainId`: its blockies identicon (as Safe{Wallet} shows them) and shortened form, linked to
// the block explorer. Hovering shows the full address.
export function AddressChip({ chainId, address }: { chainId: ChainId; address: Address }) {
  return (
    <ExternalLink href={explorerAddressUrl(chainId, address)} title={address}>
      <span className="inline-flex items-center gap-1.5 font-mono text-sm">
        <Identicon address={address} />
        {shorten(address)}
      </span>
    </ExternalLink>
  )
}
