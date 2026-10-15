// Safe Apps run in a cross-origin iframe, where Chromium rejects the async Clipboard API unless the embedding page
// grants the `clipboard-write` permission policy. The manifest requests it via `safe_apps_permissions`, but the user can
// deny it in Safe{Wallet}. The legacy `execCommand("copy")` isn't gated by that policy, so it serves as fallback while
// handling the user's click.
function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch (error) {
    if (!copyWithExecCommand(text)) {
      throw error
    }
  }
}
