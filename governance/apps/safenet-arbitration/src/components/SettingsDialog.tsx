import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { config as defaultConfig, type OracleSettings, oracleSettingsSchema } from "@/config/oracle"

type FieldErrors = Partial<Record<keyof OracleSettings, string>>

export function SettingsDialog({
  activeChainId,
  settings,
  onSave,
  onClose,
}: {
  // Chain of the connected Safe.
  activeChainId: number
  settings: OracleSettings
  onSave: (settings: OracleSettings) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [chainId, setChainId] = useState(String(settings.chainId))
  const [oracleAddress, setOracleAddress] = useState<string>(settings.oracleAddress)
  const [errors, setErrors] = useState<FieldErrors>({})

  // A modal `<dialog>` traps focus and ignores clicks on its backdrop; Escape still cancels it.
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const result = oracleSettingsSchema.safeParse({ chainId: chainId.trim(), oracleAddress: oracleAddress.trim() })
    if (!result.success) {
      const fieldErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof OracleSettings
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
        <Field id="settings-chain-id" label="Chain ID" error={errors.chainId}>
          <input
            id="settings-chain-id"
            type="text"
            inputMode="numeric"
            value={chainId}
            placeholder={String(defaultConfig.chainId)}
            onChange={(event) => {
              setChainId(event.target.value)
              setErrors((current) => ({ ...current, chainId: undefined }))
            }}
            autoComplete="off"
            aria-invalid={errors.chainId !== undefined}
            aria-describedby={errors.chainId ? "settings-chain-id-error" : undefined}
            className="w-full rounded border border-border bg-transparent p-2 font-mono text-sm"
          />
        </Field>
        <Field id="settings-oracle-address" label="Sentinel oracle address" error={errors.oracleAddress}>
          <input
            id="settings-oracle-address"
            type="text"
            value={oracleAddress}
            placeholder={defaultConfig.oracleAddress}
            onChange={(event) => {
              setOracleAddress(event.target.value)
              setErrors((current) => ({ ...current, oracleAddress: undefined }))
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors.oracleAddress !== undefined}
            aria-describedby={errors.oracleAddress ? "settings-oracle-address-error" : undefined}
            className="w-full rounded border border-border bg-transparent p-2 font-mono text-sm"
          />
        </Field>
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
