import type { ReactNode, SyntheticEvent } from "react"

// Links sit inside clickable table rows, so following them must not toggle the row.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

// A link opening in a new tab, as Safe{Wallet} frames the app. Without an `href` (e.g. on a chain without a known
// explorer), only the content is shown.
export function ExternalLink({ href, title, children }: { href?: string; title?: string; children: ReactNode }) {
  if (!href) {
    return <span title={title}>{children}</span>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      title={title}
      className="underline decoration-border underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  )
}
