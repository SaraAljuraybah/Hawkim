// Checks for the Request Hawkim form. The access-requests Edge Function checks the same rules again.

export type RequestField = 'organization' | 'contactName' | 'jobTitle' | 'email' | 'phone' | 'approxUsers' | 'message'
export type RequestValues = Record<RequestField, string>
export type FieldProblem = 'required' | 'email' | 'phone' | 'approxUsers' | 'tooLong'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A Saudi mobile number as +9665XXXXXXXX (the format profiles use), or undefined. */
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/[\s\-().]/g, '')
  const match = digits.match(/^(?:\+966|00966|966|0)?(5\d{8})$/)
  return match ? `+966${match[1]}` : undefined
}

/** The problem of each field, in the form's order; empty when the form can be sent. */
export function requestProblems(values: RequestValues): Partial<Record<RequestField, FieldProblem>> {
  const problems: Partial<Record<RequestField, FieldProblem>> = {}
  const text = (field: RequestField) => values[field].trim()
  for (const [field, max] of [['organization', 200], ['contactName', 100], ['jobTitle', 100]] as const) {
    if (!text(field)) problems[field] = 'required'
    else if (text(field).length > max) problems[field] = 'tooLong'
  }
  if (!text('email')) problems.email = 'required'
  else if (!EMAIL_PATTERN.test(text('email')) || text('email').length > 254) problems.email = 'email'
  if (!text('phone')) problems.phone = 'required'
  else if (!normalizePhone(text('phone'))) problems.phone = 'phone'
  const users = Number(text('approxUsers'))
  if (!text('approxUsers')) problems.approxUsers = 'required'
  else if (!Number.isInteger(users) || users < 1 || users > 100000) problems.approxUsers = 'approxUsers'
  if (text('message').length > 2000) problems.message = 'tooLong'
  return problems
}

/**
 * A field's problem as shown while filling in the form: on leaving it, and while typing once its error
 * shows. "required" waits for Send Request, so an empty field shows nothing here.
 */
export function liveProblem(field: RequestField, values: RequestValues): FieldProblem | undefined {
  const problem = requestProblems(values)[field]
  return problem === 'required' ? undefined : problem
}

/**
 * A refused Send Request that belongs to one field: its error shows there and focus moves to it (the
 * organization name is already taken). Other refusals are shown above the form.
 */
export function failureField(reason: string): { field: RequestField; error: 'organizationTaken' } | undefined {
  return reason === 'organization-taken' ? { field: 'organization', error: 'organizationTaken' } : undefined
}
