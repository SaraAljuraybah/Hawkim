// The steps of Cancel invitation (Staff → Sent Invitations), apart from Deno and the network, so they can be
// tested with fakes. Called by index.ts. The service key never appears in a response or a log.

import { DatabaseError } from "../add-user/flow.ts"
import { validateRequest } from "../resend-invitation/flow.ts"

export type CancelFailure =
  | "unauthorized" | "forbidden" | "invalid" | "not-found" | "no-invitation" | "already-activated"
  | "admin-managed-separately" | "cancel-failed" | "failed"

export interface CancelSteps {
  /** The Auth server verifies the session, then the database's active, non-banned Admin check. */
  caller(): Promise<"allowed" | "unauthorized" | "forbidden">
  /** cancel_invitation, as the caller: the cancellation's time, and whether it was already cancelled. */
  cancel(userId: string): Promise<{ cancelledAt: string; already: boolean }>
  /** undo_invitation_cancel, as the caller. */
  undo(userId: string, cancelledAt: string): Promise<void>
  /**
   * Blocks the sign-in account in Auth: banned (no sign-in, no link opens, no session refreshes) and a
   * password nobody knows (which ends every link issued before and every session). Service key.
   */
  block(userId: string): Promise<void>
  log(message: string): void
}

type Result = { status: number; body: Record<string, unknown> }
const refused = (status: number, errorCode: CancelFailure): Result => ({ status, body: { errorCode } })

/** What cancel_invitation refused (its hints), in the app's words. */
const REFUSALS: Partial<Record<string, [number, CancelFailure]>> = {
  forbidden: [403, "forbidden"],
  "admin-managed-separately": [403, "admin-managed-separately"],
  "not-found": [404, "not-found"],
  "no-invitation": [404, "no-invitation"],
  "already-activated": [409, "already-activated"],
}

function cancelRefusal(error: unknown): Result {
  if (!(error instanceof DatabaseError)) return refused(500, "failed")
  const known = error.hint ? REFUSALS[error.hint] : undefined
  if (known) return refused(...known)
  if (error.code === "42501" || error.code?.startsWith("PGRST30")) return refused(403, "forbidden")
  return refused(500, "failed")
}

export async function cancelInvitationFlow(input: unknown, steps: CancelSteps): Promise<Result> {
  const caller = await steps.caller()
  if (caller === "unauthorized") return refused(401, "unauthorized")
  if (caller === "forbidden") return refused(403, "forbidden")

  const userId = validateRequest(input)
  if (!userId) return refused(400, "invalid")

  // Under the row's lock: a staff member of the caller's organization, not activated. From here on the
  // database treats them as no active user, and Resend refuses the invitation.
  let cancellation: { cancelledAt: string; already: boolean }
  try {
    cancellation = await steps.cancel(userId)
  } catch (error) {
    return cancelRefusal(error)
  }

  try {
    await steps.block(userId)
  } catch (error) {
    steps.log(`block failed for ${userId}: ${error instanceof Error ? error.message : "unknown"}`)
    // A first cancellation is undone, so the invitation stays as it was and Cancel can be tried again.
    // A repeated one stays cancelled (the database already refuses them access).
    if (!cancellation.already) {
      try {
        await steps.undo(userId, cancellation.cancelledAt)
      } catch (undoError) {
        steps.log(`undo failed for ${userId}: ${undoError instanceof DatabaseError ? undoError.code ?? "unknown" : "unknown"}`)
      }
    }
    return refused(502, "cancel-failed")
  }

  steps.log(`cancelled ${userId}${cancellation.already ? " (again)" : ""}`)
  return { status: 200, body: { cancelledAt: cancellation.cancelledAt } }
}
