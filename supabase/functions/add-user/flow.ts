// The steps of Add User, apart from Deno and the network, so they can be tested with fakes. Called by
// index.ts. The account's link and the service key never appear in a response or a log.

import { contentFor, renderEmail } from "../send-email/templates.ts"

export type AddUserFailure =
  | "unauthorized" | "forbidden" | "invalid" | "email-taken" | "admin-exclusive" | "approver-quality"
  | "department-unavailable" | "permission-in-use" | "account-failed" | "account-blocked" | "failed"
  | "admin-managed-separately" | "invitation-failed" | "deactivated-admin"

/** A System Admin (the Admin permission) has no department or position: both are null. */
export type NewUserDetails = {
  name: string; email: string; phone: string; position: string | null; departmentId: string | null; permissions: string[]
}

export type SavedUser = {
  id: string; email: string; name: string; initials: string; phone: string; position: string | null; departmentId: string | null; permissions: string[]
  /** add_user brought back a deactivated profile (the same account and profile ids). */
  reactivated?: boolean
  /** add_user re-invited a staff member whose invitation was cancelled (the same account and profile ids). */
  reinvited?: boolean
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
  accountLink(email: string, name: string, linkRef: string): Promise<{ id: string; link: string; existing: boolean }>
  /** Whether Auth has the account banned. Service key. */
  isBanned(id: string): Promise<boolean>
  /** This account's profile, as the caller: none, active, or deactivated (Delete Staff, Delete Admin). */
  profileState(id: string): Promise<"none" | "active" | "deactivated">
  /** is_invitation_cancelled, as the caller: a staff member of this organization whose invitation was cancelled. */
  invitationCancelled(id: string): Promise<boolean>
  /**
   * Re-invite: lifts the ban Cancel invitation put on the account, with a password nobody knows (every earlier
   * link and session stays dead). Service key.
   */
  unblock(id: string): Promise<void>
  /** Re-invite whose invitation couldn't be sent: the account is banned again, as the cancellation left it. Service key. */
  block(id: string): Promise<void>
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
  freshLink(email: string, linkRef: string): Promise<string>
  /** deactivate_staff, as the caller: undoes a reactivation whose invitation couldn't be sent. */
  deactivate(id: string): Promise<void>
  sendEmail(to: string, subject: string, html: string): Promise<void>
  /**
   * record_invitation_sent, as the caller: when the link was sent, by whom and its reference (Sent Invitations,
   * expired-invitation notifications, and Set New Password telling a cancelled link from an expired one).
   */
  recordInvitation(id: string, linkRef: string): Promise<void>
  /**
   * A new random reference for this invitation's link, put in the link's address (?invitation=). It isn't a
   * token: it only lets Set New Password ask whether the invitation was cancelled.
   */
  newLinkRef(): string
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
  // Add Admin with a deleted Admin's email: check_new_user refuses it before the sign-in account is touched.
  "deactivated-admin",
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

  const linkRef = steps.newLinkRef()
  let account: { id: string; link: string; existing: boolean }
  // Add Staff with a deactivated staff member's email (Add Admin keeps its own order below).
  let staffReactivation = false
  // Add Staff with the email of a staff member whose invitation was cancelled: the same account and profile.
  let reinvite = false
  try {
    account = await steps.accountLink(user.email, user.name, linkRef)
    if (account.existing) {
      const banned = await steps.isBanned(account.id)
      const state = await steps.profileState(account.id)
      reinvite = state === "active" && !user.permissions.includes("admin") && await steps.invitationCancelled(account.id)
      // Blocked for another reason (not a cancelled invitation): never unblocked here.
      if (banned && !reinvite) return refused(409, "account-blocked")
      // Its email may have changed since: never touch the password of someone already using Hawkim.
      if (state === "active" && !reinvite) return refused(409, "email-taken")
      staffReactivation = state === "deactivated" && !user.permissions.includes("admin")
      // Only the emailed link can open it: not an old password, nor one set by whoever made the account.
      // A staff reactivation and a re-invite do this after add_user instead: see below.
      if (!staffReactivation && !reinvite) await steps.setRandomPassword(account.id)
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

  // Auth issues a new invite link for an email whose invite was never accepted instead of refusing it, so a
  // re-invite can arrive here as a "new" account: add_user's answer is the one that counts.
  if (saved.reinvited === true) reinvite = true

  // emailSent means the email provider accepted the invitation for delivery (not that it reached the inbox).
  let emailSent = true
  try {
    // Only the request add_user let through gets here, so only it changes the account: the old password
    // and every old session end now, and the link is made after that, so nothing ends it.
    if (staffReactivation) await steps.setRandomPassword(account.id)
    // A re-invite unblocks the account (with a new password nobody knows) only now, for this new link.
    if (reinvite) await steps.unblock(account.id)
    // A re-invite's link is made after the account is unblocked (its new password ends any link made before).
    const link = account.existing || reinvite ? await steps.freshLink(user.email, linkRef) : account.link
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

  // A re-invite whose invitation couldn't be sent stays cancelled (the database still says so, as nothing was
  // recorded) and blocked again, so Add Staff can simply be tried again.
  if (!emailSent && reinvite) {
    try {
      await steps.block(account.id)
    } catch (error) {
      // Unblocked but still cancelled in the database: no access (is_active_user), and no link was sent.
      steps.log(`could not block ${account.id} again: ${error instanceof Error ? error.message : "unknown"}`)
    }
    steps.log(`re-invite of ${account.id} not sent: still cancelled`)
    return refused(502, "invitation-failed")
  }

  // Only a link that was actually sent can expire unused. A failure here doesn't undo the user.
  if (emailSent) {
    try {
      await steps.recordInvitation(account.id, linkRef)
    } catch (error) {
      steps.log(`invitation not recorded for ${account.id}: ${error instanceof DatabaseError ? error.code ?? "unknown" : "unknown"}`)
    }
  }
  steps.log(`added ${account.id}, readded or reused: ${account.existing}, reactivated: ${!!saved.reactivated}, reinvited: ${reinvite}, email sent: ${emailSent}`)
  return { status: 200, body: { user: saved, emailSent } }
}
