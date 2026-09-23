import SafeAppsSDK from "@safe-global/safe-apps-sdk"

// Only accept messages from the official Safe{Wallet} interface, so no other page framing the app can impersonate it.
export const ALLOWED_DOMAINS = [/^https:\/\/app\.safe\.global$/]

export const sdk = new SafeAppsSDK({ allowedDomains: ALLOWED_DOMAINS })
