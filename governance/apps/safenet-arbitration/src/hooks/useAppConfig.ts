import { useMemo, useState } from "react"
import { config as defaultConfig, type AppConfig, type AppSettings, appSettingsSchema } from "@/config/app"

// Kept from when these were only oracle settings, so overrides stored before still load.
const STORAGE_KEY = "safenet-arbitration:oracleSettings"

const defaultSettings: AppSettings = {
  chainId: defaultConfig.chainId,
  oracleAddress: defaultConfig.oracleAddress,
  explorerUrl: defaultConfig.explorerUrl,
}

const isDefault = (settings: AppSettings) =>
  (Object.keys(defaultSettings) as (keyof AppSettings)[]).every((key) => settings[key] === defaultSettings[key])

// Storage can be unavailable (e.g. blocked third-party storage for the Safe App's iframe) or hold a stale or
// tampered value, so anything that doesn't parse falls back to the build-time default.
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return defaultSettings
    }
    const result = appSettingsSchema.safeParse(JSON.parse(stored))
    return result.success ? result.data : defaultSettings
  } catch {
    return defaultSettings
  }
}

function storeSettings(settings: AppSettings) {
  try {
    // Only persist actual overrides, so a later change of the build-time default isn't shadowed by a stale copy.
    if (isDefault(settings)) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
  } catch (error) {
    // The override still applies for this session.
    console.warn("Failed to persist settings override", error)
  }
}

// The build-time config, with the settings dialog's fields (chain ID, oracle address, URLs) optionally overridden.
export function useAppConfig(): { config: AppConfig; setSettings: (settings: AppSettings) => void } {
  const [settings, setSettingsState] = useState(loadSettings)

  const setSettings = (next: AppSettings) => {
    storeSettings(next)
    setSettingsState(next)
  }

  const config = useMemo(() => ({ ...defaultConfig, ...settings }), [settings])
  return { config, setSettings }
}
