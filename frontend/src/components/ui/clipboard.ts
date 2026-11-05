/**
 * Copies text with the Clipboard API. Resolves false instead of throwing when it is
 * unavailable (e.g. not a secure context) or the browser refuses. Pure apart from the clipboard.
 */
export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
