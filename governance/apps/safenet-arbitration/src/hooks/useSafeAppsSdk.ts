import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { SafeInfo } from "@safe-global/safe-apps-sdk"
import { useEffect, useState } from "react"
import { sdk as defaultSdk } from "@/lib/safe"

// Outside of Safe{Wallet}, `safe.getInfo()` never resolves (there is no parent frame to answer it), so give up after
// this long and report the app as not running inside a Safe.
const CONNECT_TIMEOUT_MS = 3000

export type SafeConnection =
  { status: "connecting" } | { status: "connected"; safe: SafeInfo } | { status: "unavailable" }

async function connect(sdk: SafeAppsSDK, timeoutMs: number): Promise<SafeInfo | undefined> {
  if (window.parent === window) {
    return undefined
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })
  try {
    return await Promise.race([sdk.safe.getInfo(), timeout])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export function useSafeAppsSdk(
  sdk: SafeAppsSDK = defaultSdk,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): { sdk: SafeAppsSDK; connection: SafeConnection } {
  const [connection, setConnection] = useState<SafeConnection>({ status: "connecting" })

  useEffect(() => {
    let cancelled = false
    connect(sdk, timeoutMs).then((safe) => {
      if (!cancelled) {
        setConnection(safe ? { status: "connected", safe } : { status: "unavailable" })
      }
    })
    return () => {
      cancelled = true
    }
  }, [sdk, timeoutMs])

  return { sdk, connection }
}
