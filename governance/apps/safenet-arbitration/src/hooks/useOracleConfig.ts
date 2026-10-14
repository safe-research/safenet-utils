import { useMemo, useState } from "react"
import { config as defaultConfig, type OracleConfig, type OracleSettings, oracleSettingsSchema } from "@/config/oracle"

const STORAGE_KEY = "safenet-arbitration:oracleSettings"

const defaultSettings: OracleSettings = { chainId: defaultConfig.chainId, oracleAddress: defaultConfig.oracleAddress }

// Storage can be unavailable (e.g. blocked third-party storage for the Safe App's iframe) or hold a stale or
// tampered value, so anything that doesn't parse falls back to the build-time default.
function loadSettings(): OracleSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return defaultSettings
    }
    const result = oracleSettingsSchema.safeParse(JSON.parse(stored))
    return result.success ? result.data : defaultSettings
  } catch {
    return defaultSettings
  }
}

function storeSettings(settings: OracleSettings) {
  try {
    // Only persist actual overrides, so a later change of the build-time default isn't shadowed by a stale copy.
    if (settings.chainId === defaultSettings.chainId && settings.oracleAddress === defaultSettings.oracleAddress) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
  } catch (error) {
    // The override still applies for this session.
    console.warn("Failed to persist oracle settings override", error)
  }
}

// The build-time config, with the chain ID and oracle address optionally overridden from the settings dialog.
export function useOracleConfig(): { config: OracleConfig; setSettings: (settings: OracleSettings) => void } {
  const [settings, setSettingsState] = useState(loadSettings)

  const setSettings = (next: OracleSettings) => {
    storeSettings(next)
    setSettingsState(next)
  }

  const config = useMemo(() => ({ ...defaultConfig, ...settings }), [settings])
  return { config, setSettings }
}
