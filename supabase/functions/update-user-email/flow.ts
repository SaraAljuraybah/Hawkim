// The steps of changing a staff member's email, apart from Deno and the network, so they can be tested
// with fakes. Called by index.ts. The sign-in account and the profile always end with the same email:
// the database checks first, then the account changes, then the profile; if the profile can't be
// saved, the account goes back to its previous email.

export type UpdateEmailFailure =
  | "unauthorized" | "forbidden" | "invalid" | "not-found" | "email-taken" | "account-failed" | "failed"

export class DatabaseError extends Error {
  readonly code?: string
  readonly hint?: string | null
  constructor(error: { code?: string; message?: string; hint?: string | null }) {
    super(error.message ?? "database error")
    this.code = error.code
    this.hint = error.hint
  }
}

/** Auth refused the new email because another account already has it. */
export class EmailInUseError extends Error {}

export interface UpdateEmailSteps {
  /** The Auth server verifies the session, then the database's active, non-banned Admin check. */
  caller(): Promise<"allowed" | "unauthorized" | "forbidden">
  /** set_user_email, as the caller: a dry run (apply false) or the save (apply true). */
  setProfileEmail(userId: string, email: string, apply: boolean): Promise<void>
  /** The sign-in account's current email, or undefined when there is no such account. Service key. */
  accountEmail(userId: string): Promise<string | undefined>
  /** Changes the sign-in email, confirmed (the admin manages it). Throws EmailInUseError. Service key. */
  setAccountEmail(userId: string, email: string): Promise<void>
  log(message: string): void
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The cleaned request (the email in lowercase, as stored), or undefined when it isn't valid. */
export function validateRequest(input: unknown): { userId: string; email: string } | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const body = input as Record<string, unknown>
  const userId = typeof body.userId === "string" ? body.userId.trim() : ""
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!UUID.test(userId) || !EMAIL.test(email) || email.length > 254) return undefined
  return { userId, email }
}

type Result = { status: number; body: Record<string, unknown> }
const refused = (status: number, errorCode: UpdateEmailFailure): Result => ({ status, body: { errorCode } })

function databaseRefusal(error: unknown): Result {
  if (!(error instanceof DatabaseError)) return refused(500, "failed")
  if (error.code === "42501" || error.code?.startsWith("PGRST30")) return refused(403, "forbidden")
  if (error.code === "P0002") return refused(404, "not-found")
  if (error.hint === "email-taken") return refused(409, "email-taken")
  if (error.hint === "invalid" || error.code === "23514") return refused(400, "invalid")
  return refused(500, "failed")
}

export async function updateEmailFlow(input: unknown, steps: UpdateEmailSteps): Promise<Result> {
  const caller = await steps.caller()
  if (caller === "unauthorized") return refused(401, "unauthorized")
  if (caller === "forbidden") return refused(403, "forbidden")

  const request = validateRequest(input)
  if (!request) return refused(400, "invalid")
  const { userId, email } = request

  try {
    await steps.setProfileEmail(userId, email, false)
  } catch (error) {
    return databaseRefusal(error)
  }

  let previous: string | undefined
  try {
    previous = await steps.accountEmail(userId)
  } catch (error) {
    steps.log(`read account failed: ${error instanceof Error ? error.message : "unknown"}`)
    return refused(502, "account-failed")
  }
  if (previous === undefined) return refused(404, "not-found")

  const accountChanged = previous.toLowerCase() !== email
  if (accountChanged) {
    try {
      await steps.setAccountEmail(userId, email)
    } catch (error) {
      if (error instanceof EmailInUseError) return refused(409, "email-taken")
      steps.log(`account email failed for ${userId}: ${error instanceof Error ? error.message : "unknown"}`)
      return refused(502, "account-failed")
    }
  }

  try {
    await steps.setProfileEmail(userId, email, true)
  } catch (error) {
    if (accountChanged) {
      try {
        await steps.setAccountEmail(userId, previous)
      } catch {
        steps.log(`could not restore the account email of ${userId}`)
      }
    }
    return databaseRefusal(error)
  }
  steps.log(`email changed for ${userId}, account changed: ${accountChanged}`)
  return { status: 200, body: { userId, email } }
}
