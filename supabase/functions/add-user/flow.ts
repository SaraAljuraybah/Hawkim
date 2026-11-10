// The steps of Add User, apart from Deno and the network, so they can be tested with fakes. Called by
// index.ts. The account's link and the service key never appear in a response or a log.

import { contentFor, renderEmail } from "../send-email/templates.ts"

export type AddUserFailure =
  | "unauthorized" | "forbidden" | "invalid" | "email-taken" | "admin-exclusive" | "approver-quality"
  | "department-unavailable" | "permission-in-use" | "account-failed" | "account-blocked" | "failed"
  | "admin-managed-separately" | "invitation-failed"

/** A System Admin (the Admin permission) has no department or position: both are null. */
export type NewUserDetails = {
  name: string; email: string; phone: string; position: string | null; departmentId: string | null; permissions: string[]
}

export type SavedUser = {
  id: string; email: string; name: string; initials: string; phone: string; position: string | null; departmentId: string | null; permissions: string[]
  /** add_user brought back a deactivated profile (the same account and profile ids). */
  reactivated?: boolean
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
  /**
   * Creates the account with its invitation link, or finds it; `existing` when it already had one (then
   * there is no link yet: see freshLink). Service key.
   */
  accountLink(email: string, name: string): Promise<{ id: string; link: string; existing: boolean }>
  /** Whether Auth has the account banned. Service key. */
  isBanned(id: string): Promise<boolean>
  /** This account's profile, as the caller: none, active, or deactivated (Delete Staff, Delete Admin). */
  profileState(id: string): Promise<"none" | "active" | "deactivated">
  /**
   * Replaces the account's password with one nobody knows. Service key. Auth also ends all of the
   * account's sessions and any link made before (measured on GoTrue v2.197, the hosted version).
   */
  setRandomPassword(id: string): Promise<void>
  /** add_user, as the caller. */
  addUser(id: string, user: NewUserDetails): Promise<SavedUser>
  /**
   * A password-setup (recovery) link for an account that already existed, made after its password was
   * replaced and its profile saved: Auth ends any link made before a password change, and only the
   * request whose profile was saved makes one. Service key.
   */
  freshLink(email: string): Promise<string>
  /** deactivate_staff, as the caller: undoes a reactivation whose invitation couldn't be sent. */
  deactivate(id: string): Promise<void>
  sendEmail(to: string, subject: string, html: string): Promise<void>
  /** record_invitation_sent, as the caller: when the link was sent and by whom (for expired-invitation notifications). */
  recordInvitation(id: string): Promise<void>
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
  if (!name || name.length > 100 || !EMAIL.test(email) || email.length > 254 || !PHONE.test(phone) || !Array.isArray(body.permissions)) return undefined
  const permissions = body.permissions as unknown[]
  if (!permissions.every((item) => typeof item === "string" && PERMISSIONS.includes(item))) return undefined
  const unique = [...new Set(permissions as string[])]
  // A System Admin's department and position are never saved; everyone else needs both.
  if (unique.includes("admin")) return { name, email, phone, position: null, departmentId: null, permissions: unique }
  if (!position || position.length > 100 || !departmentId) return undefined
  return { name, email, phone, position, departmentId, permissions: unique }
}

/** The invitation: the wording of Supabase's invite email, and what to do when the link has expired. */
export function invitationEmail(email: string, link: string): { subject: string; html: string } {
  const content = {
    ...contentFor("invite", email),
    note: "This link expires in 24 hours and can be used once. If it has expired, use “Forgot password?” on the sign-in page. If you weren’t expecting this invitation, you can ignore this email.",
  }
  return { subject: content.subject, html: renderEmail(content, link) }
}

type Result = { status: number; body: Record<string, unknown> }
const refused = (status: number, errorCode: AddUserFailure, extra: Record<string, unknown> = {}): Result => ({ status, body: { errorCode, ...extra } })

const REFUSALS: AddUserFailure[] = [
  "invalid", "email-taken", "admin-exclusive", "approver-quality", "department-unavailable", "permission-in-use", "admin-managed-separately",
]

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
  // Add Staff with a deactivated staff member's email (Add Admin keeps its own order below).
  let staffReactivation = false
  try {
    account = await steps.accountLink(user.email, user.name)
    if (account.existing) {
      if (await steps.isBanned(account.id)) return refused(409, "account-blocked")
      const state = await steps.profileState(account.id)
      // Its email may have changed since: never touch the password of someone already using Hawkim.
      if (state === "active") return refused(409, "email-taken")
      staffReactivation = state === "deactivated" && !user.permissions.includes("admin")
      // Only the emailed link can open it: not an old password, nor one set by whoever made the account.
      // A staff reactivation does this after add_user instead: see below.
      if (!staffReactivation) await steps.setRandomPassword(account.id)
    }
  } catch (error) {
    steps.log(`account failed: ${error instanceof Error ? error.message : "unknown"}`)
    return refused(502, "account-failed")
  }

  let saved: SavedUser
  try {
    saved = await steps.addUser(account.id, user)
  } catch (error) {
    // The account stays without a profile (or deactivated): it can't reach anything, and a retry reuses it.
    // A refused staff reactivation (e.g. a concurrent Add Staff got there first) touched nothing in Auth,
    // so it can't spoil the other request's invitation.
    steps.log(`profile failed for ${account.id}: ${error instanceof DatabaseError ? error.code ?? "unknown" : "unknown"}`)
    return databaseRefusal(error)
  }

  // emailSent means the email provider accepted the invitation for delivery (not that it reached the inbox).
  let emailSent = true
  try {
    // Only the request add_user let through gets here, so only it changes the account: the old password
    // and every old session end now, and the link is made after that, so nothing ends it.
    if (staffReactivation) await steps.setRandomPassword(account.id)
    const link = account.existing ? await steps.freshLink(user.email) : account.link
    const email = invitationEmail(user.email, link)
    await steps.sendEmail(user.email, email.subject, email.html)
  } catch (error) {
    emailSent = false
    steps.log(`invitation failed for ${account.id}: ${error instanceof Error ? error.message : "unknown"}`)
  }

  // A deactivated staff member is only active again with a new invitation on its way: otherwise they
  // go back to deactivated, and Add Staff can simply be tried again (the same account and profile).
  if (!emailSent && saved.reactivated && !user.permissions.includes("admin")) {
    try {
      await steps.deactivate(account.id)
      steps.log(`reactivation of ${account.id} undone: no invitation`)
      return refused(502, "invitation-failed")
    } catch (error) {
      // Still active, without an invitation: said as for any other add (they can use Forgot password).
      steps.log(`could not undo the reactivation of ${account.id}: ${error instanceof DatabaseError ? error.code ?? "unknown" : "unknown"}`)
    }
  }

  // Only a link that was actually sent can expire unused. A failure here doesn't undo the user.
  if (emailSent) {
    try {
      await steps.recordInvitation(account.id)
    } catch (error) {
      steps.log(`invitation not recorded for ${account.id}: ${error instanceof DatabaseError ? error.code ?? "unknown" : "unknown"}`)
    }
  }
  steps.log(`added ${account.id}, readded or reused: ${account.existing}, reactivated: ${!!saved.reactivated}, email sent: ${emailSent}`)
  return { status: 200, body: { user: saved, emailSent } }
}
