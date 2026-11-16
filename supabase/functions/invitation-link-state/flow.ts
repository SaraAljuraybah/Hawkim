// What became of an invitation link, for Set New Password (signed out): the steps apart from Deno and the
// network, so they can be tested with fakes. Called by index.ts. Says only the link's state, nothing about
// the person; the reference in the link is random and grants nothing.

export type LinkState = "cancelled" | "replaced" | "expired" | "used" | "valid" | "unknown"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATES: LinkState[] = ["cancelled", "replaced", "expired", "used", "valid", "unknown"]

type Result = { status: number; body: Record<string, unknown> }

/** `{ linkRef: <uuid> }` → `{ state }`; `lookup` is invitation_link_state, with the service key. */
export async function linkStateFlow(input: unknown, lookup: (linkRef: string) => Promise<unknown>, log: (message: string) => void): Promise<Result> {
  const linkRef = typeof input === "object" && input !== null ? (input as Record<string, unknown>).linkRef : undefined
  if (typeof linkRef !== "string" || !UUID.test(linkRef)) return { status: 400, body: { errorCode: "invalid" } }
  try {
    const state = await lookup(linkRef.toLowerCase())
    return { status: 200, body: { state: STATES.find((item) => item === state) ?? "unknown" } }
  } catch (error) {
    log(`lookup failed: ${error instanceof Error ? error.name : "unknown"}`)
    return { status: 500, body: { errorCode: "failed" } }
  }
}
