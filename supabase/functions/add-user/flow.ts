// The steps of Add User, apart from Deno and the network, so they can be tested with fakes. Called by
// index.ts. The account's link and the service key never appear in a response or a log.

import { contentFor, renderEmail } from "../send-email/templates.ts"

export type AddUserFailure =
  | "unauthorized" | "forbidden" | "invalid" | "email-taken" | "admin-exclusive" | "approver-quality"
  | "department-unavailable" | "permission-in-use" | "account-failed" | "account-blocked" | "failed"

export type NewUserDetails = {
  name: string; email: string; phone: string; position: string; departmentId: string; permissions: string[]
}

export type SavedUser = {
  id: string; email: string; name: string; initials: string; phone: string; position: string; departmentId: string; permissions: string[]
}

export class DatabaseError extends Error {
  readonly code?: string
  readonly hint?: string | null
  readonly details?: string | null
  constructor(error: { code?: string; message?: string; hint?: string | null; details?: string | null }) {
    super(error.message ?? "database error")
    this.code = error.code
    this.hint = error.hint
    this.details = error.details
  }
}

export interface AddUserSteps {
  /** The Auth server verifies the session, then the database's active, non-banned Admin check. */
  caller(): Promise<"allowed" | "unauthorized" | "forbidden">
  /** check_new_user, as the caller. */
  checkNewUser(user: NewUserDetails): Promise<void>
  /** Creates the account, or finds it; `existing` when it already had one. Service key. */
  accountLink(email: string, name: string): Promise<{ id: string; link: string; existing: boolean }>
  /** Whether Auth has the account banned. Service key. */
  isBanned(id: string): Promise<boolean>
  /** Whether this account has a profile that isn't deleted, as the caller. */
  hasActiveProfile(id: string): Promise<boolean>
  /** Replaces the account's password with one nobody knows. Service key. */
  setRandomPassword(id: string): Promise<void>
  /** add_user, as the caller. */
  addUser(id: string, user: NewUserDetails): Promise<SavedUser>
  sendEmail(to: string, subject: string, html: string): Promise<void>
  log(message: string): void
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+9665[0-9]{8}$/
const PERMISSIONS = ["author", "reviewer", "approver", "admin"]

/** The cleaned details (the email in lowercase, which is how it is stored), or undefined when they aren't valid. */
export function validateDetails(input: unknown): NewUserDetails | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const body = input as Record<string, unknown>
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "")
  const name = text("name"), email = text("email").toLowerCase(), phone = text("phone"), position = text("position"), departmentId = text("departmentId")
  if (!name || name.length > 100 || !EMAIL.test(email) || email.length > 254 || !PHONE.test(phone)
    || !position || position.length > 100 || !departmentId || !Array.isArray(body.permissions)) return undefined
  const permissions = body.permissions as unknown[]
  if (!permissions.every((item) => typeof item === "string" && PERMISSIONS.includes(item))) return undefined
  return { name, email, phone, position, departmentId, permissions: [...new Set(permissions as string[])] }
}

/** The invitation: the wording of Supabase's invite email, and what to do when the link has expired. */
export function invitationEmail(email: string, link: string): { subject: string; html: string } {
  const content = {
    ...contentFor("invite", email),
    note: "This link expires in 1 hour and can be used once. If it has expired, use “Forgot password?” on the sign-in page. If you weren’t expecting this invitation, you can ignore this email.",
  }
  return { subject: content.subject, html: renderEmail(content, link) }
}

type Result = { status: number; body: Record<string, unknown> }
const refused = (status: number, errorCode: AddUserFailure, extra: Record<string, unknown> = {}): Result => ({ status, body: { errorCode, ...extra } })

const REFUSALS: AddUserFailure[] = ["invalid", "email-taken", "admin-exclusive", "approver-quality", "department-unavailable", "permission-in-use"]

/** What the database refused, in the app's words. */
function databaseRefusal(error: unknown): Result {
  if (!(error instanceof DatabaseError)) return refused(500, "failed")
  if (error.code === "42501" || error.code?.startsWith("PGRST30")) return refused(403, "forbidden")
  const hinted = REFUSALS.find((reason) => reason === error.hint)
  if (hinted === "permission-in-use") return refused(409, hinted, { inUse: error.details ?? "" })
  if (hinted) return refused(hinted === "invalid" ? 400 : 409, hinted)
  // A rule of the database's triggers, or update_user_details refusing the details.
  if (error.code === "23514") return refused(400, "invalid")
  return refused(500, "failed")
}

export async function addUserFlow(input: unknown, steps: AddUserSteps): Promise<Result> {
  const caller = await steps.caller()
  if (caller === "unauthorized") return refused(401, "unauthorized")
  if (caller === "forbidden") return refused(403, "forbidden")

  const user = validateDetails(input)
  if (!user) return refused(400, "invalid")

  try {
    await steps.checkNewUser(user)
  } catch (error) {
    return databaseRefusal(error)
  }

  let account: { id: string; link: string; existing: boolean }
  try {
    account = await steps.accountLink(user.email, user.name)
    if (account.existing) {
      if (await steps.isBanned(account.id)) return refused(409, "account-blocked")
      // Its email may have changed since: never touch the password of someone already using Hawkim.
      if (await steps.hasActiveProfile(account.id)) return refused(409, "email-taken")
      // Only the emailed link can open it: not an old password, nor one set by whoever made the account.
      await steps.setRandomPassword(account.id)
    }
  } catch (error) {
    steps.log(`account failed: ${error instanceof Error ? error.message : "unknown"}`)
    return refused(502, "account-failed")
  }

  let saved: SavedUser
  try {
    saved = await steps.addUser(account.id, user)
  } catch (error) {
    // The account stays without a profile: it can't reach anything, and a retry reuses it.
    steps.log(`profile failed for ${account.id}: ${error instanceof DatabaseError ? error.code ?? "unknown" : "unknown"}`)
    return databaseRefusal(error)
  }

  let emailSent = true
  try {
    const email = invitationEmail(user.email, account.link)
    await steps.sendEmail(user.email, email.subject, email.html)
  } catch (error) {
    emailSent = false
    steps.log(`invitation failed for ${account.id}: ${error instanceof Error ? error.message : "unknown"}`)
  }
  steps.log(`added ${account.id}, readded or reused: ${account.existing}, email sent: ${emailSent}`)
  return { status: 200, body: { user: saved, emailSent } }
}
