/*
 * The SOP versions this browser sent for approval. Approval isn't in the database yet, so after
 * a reload this keeps Submit for approval disabled ("Already sent for approval."). Stored as
 * { [sopId]: version }. Storage can be unavailable (private mode, blocked), so every access is optional.
 */

const STORAGE_KEY = 'hawkim.sentForApproval'

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch {
    return {} // storage unavailable or unreadable: nothing remembered
  }
}

function write(sent: Record<string, string>): void {
  try {
    if (Object.keys(sent).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(sent))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Remembering is optional; ignore storage errors.
  }
}

/** Whether this browser sent this version of the SOP for approval. */
export function wasSentForApproval(sopId: string, version: string): boolean {
  return read()[sopId] === version
}

export function rememberSentForApproval(sopId: string, version: string): void {
  write({ ...read(), [sopId]: version })
}

/** After the approver returns the SOP, or a new version is uploaded. */
export function forgetSentForApproval(sopId: string): void {
  const sent = read()
  if (!(sopId in sent)) return
  delete sent[sopId]
  write(sent)
}
