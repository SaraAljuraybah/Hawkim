// The steps of Resend invitation, apart from Deno and the network, so they can be tested with fakes.
// Called by index.ts. The new link and the service key never appear in a response or a log.

import { DatabaseError, invitationEmail } from "../add-user/flow.ts"

export type ResendFailure =
  | "unauthorized" | "forbidden" | "invalid" | "not-found" | "no-invitation" | "account-blocked"
  | "already-activated" | "still-valid" | "super-admin-required" | "link-failed" | "email-failed" | "failed"

export interface ResendSteps {
  /** The Auth server verifies the session, then the database's active, non-banned Admin check. */
  caller(): Promise<"allowed" | "unauthorized" | "forbidden">
  /** claim_invitation_resend, as the caller: the account's email and the claim's time. */
  claim(userId: string): Promise<{ email: string; claimedAt: string }>
  /** revert_invitation_resend, as the caller. */
  revert(userId: string, claimedAt: string): Promise<void>
  /** A new activation link for the account (replacing the old one). Service key. */
  newLink(email: string): Promise<string>
  sendEmail(to: string, subject: string, html: string): Promise<void>
  log(message: string): void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The person to resend to, or undefined when the request isn't `{ userId: <uuid> }`. */
export function validateRequest(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const userId = (input as Record<string, unknown>).userId
  return typeof userId === "string" && UUID.test(userId) ? userId.toLowerCase() : undefined
}

type Result = { status: number; body: Record<string, unknown> }
const refused = (status: number, errorCode: ResendFailure): Result => ({ status, body: { errorCode } })

/** What claim_invitation_resend refused (its hints), in the app's words. */
const CLAIM_REFUSALS: Partial<Record<string, [number, ResendFailure]>> = {
  forbidden: [403, "forbidden"],
  "super-admin-required": [403, "super-admin-required"],
  "not-found": [404, "not-found"],
  "no-invitation": [404, "no-invitation"],
  "account-blocked": [409, "account-blocked"],
  "already-activated": [409, "already-activated"],
  "still-valid": [409, "still-valid"],
}

function claimRefusal(error: unknown): Result {
  if (!(error instanceof DatabaseError)) return refused(500, "failed")
  const known = error.hint ? CLAIM_REFUSALS[error.hint] : undefined
  if (known) return refused(...known)
  if (error.code === "42501" || error.code?.startsWith("PGRST30")) return refused(403, "forbidden")
  return refused(500, "failed")
}

export async function resendInvitationFlow(input: unknown, steps: ResendSteps): Promise<Result> {
  const caller = await steps.caller()
  if (caller === "unauthorized") return refused(401, "unauthorized")
  if (caller === "forbidden") return refused(403, "forbidden")

  const userId = validateRequest(input)
  if (!userId) return refused(400, "invalid")

  // Under the row's lock: still a person, not activated, the link expired. A second click is refused here.
  let claim: { email: string; claimedAt: string }
  try {
    claim = await steps.claim(userId)
  } catch (error) {
    return claimRefusal(error)
  }

  // Anything after the claim that fails puts the previous sending back, so Resend can be tried again.
  const undo = async (failure: "link-failed" | "email-failed", error: unknown): Promise<Result> => {
    steps.log(`${failure} for ${userId}: ${error instanceof Error ? error.message : "unknown"}`)
    try {
      await steps.revert(userId, claim.claimedAt)
    } catch (revertError) {
      steps.log(`revert failed for ${userId}: ${revertError instanceof DatabaseError ? revertError.code ?? "unknown" : "unknown"}`)
    }
    return refused(502, failure)
  }

  let link: string
  try {
    link = await steps.newLink(claim.email)
  } catch (error) {
    return undo("link-failed", error)
  }

  try {
    const email = invitationEmail(claim.email, link)
    await steps.sendEmail(claim.email, email.subject, email.html)
  } catch (error) {
    return undo("email-failed", error)
  }

  steps.log(`resent ${userId}`)
  return { status: 200, body: { email: claim.email } }
}
