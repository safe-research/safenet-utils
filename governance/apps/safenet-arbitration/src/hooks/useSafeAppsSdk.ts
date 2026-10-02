import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { useEffect, useState } from "react"
import { sdk as defaultSdk } from "@/lib/safe"

// Outside of Safe{Wallet}, `safe.getInfo()` never resolves (there is no parent frame to answer it), so give up after
// this long and treat the connection as unavailable.
const CONNECT_TIMEOUT_MS = 3000

// The connected Safe or chain can change under the app without a reload, so re-check while the page is visible.
const REFRESH_INTERVAL_MS = 30_000

export type SafeConnection =
  { status: "connecting" } | { status: "connected"; safe: SafeInfo } | { status: "unavailable" }

async function connect(sdk: SafeAppsSDK, timeoutMs: number): Promise<SafeInfo | undefined> {
  if (window.parent === window) {
    return undefined
  }
  let timer: number | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = window.setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([sdk.safe.getInfo(), timeout])
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}

function sameSafe(left: SafeInfo, right: SafeInfo): boolean {
  return (
    left.safeAddress === right.safeAddress &&
    left.chainId === right.chainId &&
    left.threshold === right.threshold &&
    left.isReadOnly === right.isReadOnly &&
    left.owners.length === right.owners.length &&
    left.owners.every((owner, i) => owner === right.owners[i])
  )
}

// A failed check always drops to `unavailable`, so a stale identity is never kept. An unchanged Safe keeps its object
// identity, so consumers don't re-render on every poll.
function nextConnection(previous: SafeConnection, safe: SafeInfo | undefined): SafeConnection {
  if (!safe) {
    return previous.status === "unavailable" ? previous : { status: "unavailable" }
  }
  if (previous.status === "connected" && sameSafe(previous.safe, safe)) {
    return previous
  }
  return { status: "connected", safe }
}

// Checks the connection now, then every `REFRESH_INTERVAL_MS` while the page is visible and as soon as it becomes
// visible again. Only one check runs at a time. Returns a function that stops all checks and reporting.
function watchConnection(
  sdk: SafeAppsSDK,
  timeoutMs: number,
  onChecked: (safe: SafeInfo | undefined) => void,
): () => void {
  let stopped = false
  let checking = false
  let interval: number | undefined

  const check = async () => {
    if (checking) {
      return
    }
    checking = true
    try {
      const safe = await connect(sdk, timeoutMs)
      if (!stopped) {
        onChecked(safe)
      }
    } finally {
      checking = false
    }
  }
  const setPolling = (visible: boolean) => {
    if (visible && interval === undefined) {
      interval = window.setInterval(check, REFRESH_INTERVAL_MS)
    } else if (!visible && interval !== undefined) {
      window.clearInterval(interval)
      interval = undefined
    }
  }
  const onVisibilityChange = () => {
    const visible = document.visibilityState === "visible"
    setPolling(visible)
    if (visible) {
      check()
    }
  }

  check()
  setPolling(document.visibilityState === "visible")
  document.addEventListener("visibilitychange", onVisibilityChange)
  return () => {
    stopped = true
    setPolling(false)
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}

export function useSafeAppsSdk(
  sdk: SafeAppsSDK = defaultSdk,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): { sdk: SafeAppsSDK; connection: SafeConnection } {
  const [connection, setConnection] = useState<SafeConnection>({ status: "connecting" })

  useEffect(
    () => watchConnection(sdk, timeoutMs, (safe) => setConnection((previous) => nextConnection(previous, safe))),
    [sdk, timeoutMs],
  )

  return { sdk, connection }
}
