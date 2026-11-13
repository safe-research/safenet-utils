import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { config as defaultConfig, type AppSettings, appSettingsSchema } from "@/config/app"

type SettingsKey = keyof AppSettings
type FieldValues = Record<SettingsKey, string>
type FieldErrors = Partial<Record<SettingsKey, string>>

const FIELDS: { key: SettingsKey; label: string; numeric?: boolean }[] = [
  { key: "chainId", label: "Chain ID", numeric: true },
  { key: "oracleAddress", label: "Sentinel oracle address" },
  { key: "explorerUrl", label: "Safenet Explorer URL" },
  { key: "sentinelInfoUrl", label: "Sentinel info URL" },
]

const toFieldValues = (settings: AppSettings): FieldValues => ({
  chainId: String(settings.chainId),
  oracleAddress: settings.oracleAddress,
  explorerUrl: settings.explorerUrl,
  sentinelInfoUrl: settings.sentinelInfoUrl,
})

export function SettingsDialog({
  activeChainId,
  settings,
  onSave,
  onClose,
}: {
  // Chain of the connected Safe.
  activeChainId: number
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState(() => toFieldValues(settings))
  const [errors, setErrors] = useState<FieldErrors>({})
  const placeholders = toFieldValues(defaultConfig)

  // A modal `<dialog>` traps focus and ignores clicks on its backdrop; Escape still cancels it.
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]))
    const result = appSettingsSchema.safeParse(trimmed)
    if (!result.success) {
      const fieldErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as SettingsKey
        fieldErrors[field] ??= issue.message
      }
      setErrors(fieldErrors)
      return
    }
    onSave(result.data)
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      aria-labelledby="settings-title"
      className="m-auto w-full max-w-lg rounded border border-border-subtle bg-surface p-4 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={onSubmit} noValidate>
        <h2 id="settings-title" className="mb-3 text-lg font-semibold">
          Settings
        </h2>
        <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-4 text-sm">
          <dt className="text-muted-foreground">Active network</dt>
          <dd className="font-mono">Chain ID {activeChainId}</dd>
        </dl>
        <p className="mb-3 text-sm text-muted-foreground">Leave a field empty to reset it to the default.</p>
        {FIELDS.map(({ key, label, numeric }) => {
          const id = `settings-${key}`
          return (
            <Field key={key} id={id} label={label} error={errors[key]}>
              <input
                id={id}
                type="text"
                inputMode={numeric ? "numeric" : undefined}
                value={values[key]}
                placeholder={placeholders[key]}
                onChange={(event) => {
                  const value = event.target.value
                  setValues((current) => ({ ...current, [key]: value }))
                  setErrors((current) => ({ ...current, [key]: undefined }))
                }}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={errors[key] !== undefined}
                aria-describedby={errors[key] ? `${id}-error` : undefined}
                className="w-full rounded border border-border bg-transparent p-2 font-mono text-sm"
              />
            </Field>
          )
        })}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-subtle"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary-hover"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  )
}

// A labelled input with its validation error; the error's id is `${id}-error`, for the input's `aria-describedby`.
function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm text-muted-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
