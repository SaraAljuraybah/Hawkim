// Checks for the Request Hawkim form. The access-requests Edge Function checks the same rules again.
// No Position: the applicant becomes the Super Admin, and Admins have no position.

import { reviewRequestEn } from '../content/accessRequest.en'
import type { OrganizationProfileField } from '../content/types'
import type { AccessRequestView } from '../services/accessRequests'
import { missingAddressAndMapsUrl, organizationDetailProblem } from './organizationDetails'

/**
 * `email` is the contact person's email. The organization's details are `organization…`: the Website is
 * `organizationWebsite`, never `website` (the hidden field for bots).
 */
export type RequestField =
  | 'organization' | 'contactName' | 'email' | 'phone'
  | 'organizationEmail' | 'organizationAddress' | 'organizationMapsUrl' | 'organizationWebsite' | 'organizationDescription'
  | 'approxUsers' | 'message'
export type RequestValues = Record<RequestField, string>
/** Where a problem shows: a field, or the Address group (Address and Google Maps link both empty). */
export type RequestErrorKey = RequestField | 'addressGroup'
export type FieldProblem = 'required' | 'email' | 'phone' | 'approxUsers' | 'url' | 'tooLong'

/** The problems in the form's order (focus goes to the first); the Address group comes before its two fields. */
export const REQUEST_ERROR_ORDER: readonly RequestErrorKey[] = [
  'organization', 'contactName', 'email', 'phone',
  'organizationEmail', 'addressGroup', 'organizationAddress', 'organizationMapsUrl', 'organizationWebsite', 'organizationDescription',
  'approxUsers', 'message',
]

/** The organization's details on the form, and the Organization Profile value whose rules they follow. */
const ORGANIZATION_DETAILS: readonly [RequestField, OrganizationProfileField][] = [
  ['organizationEmail', 'email'], ['organizationAddress', 'address'], ['organizationMapsUrl', 'mapsUrl'],
  ['organizationWebsite', 'website'], ['organizationDescription', 'description'],
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A Saudi mobile number as +9665XXXXXXXX (the format profiles use), or undefined. */
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/[\s\-().]/g, '')
  const match = digits.match(/^(?:\+966|00966|966|0)?(5\d{8})$/)
  return match ? `+966${match[1]}` : undefined
}

/**
 * The problem of each field (and of the Address group); empty when the form can be sent. The organization's
 * details follow the Organization Profile's rules (lib/organizationDetails.ts): the organization email and the
 * description are required, an address or a Google Maps link (at least one), the website optional.
 */
export function requestProblems(values: RequestValues): Partial<Record<RequestErrorKey, FieldProblem>> {
  const problems: Partial<Record<RequestErrorKey, FieldProblem>> = {}
  const text = (field: RequestField) => values[field].trim()
  for (const [field, max] of [['organization', 200], ['contactName', 100]] as const) {
    if (!text(field)) problems[field] = 'required'
    else if (text(field).length > max) problems[field] = 'tooLong'
  }
  if (!text('email')) problems.email = 'required'
  else if (!EMAIL_PATTERN.test(text('email')) || text('email').length > 254) problems.email = 'email'
  if (!text('phone')) problems.phone = 'required'
  else if (!normalizePhone(text('phone'))) problems.phone = 'phone'
  for (const [field, profileField] of ORGANIZATION_DETAILS) {
    const required = field === 'organizationEmail' || field === 'organizationDescription'
    const problem = required && !text(field) ? 'required' : organizationDetailProblem(profileField, values[field])
    if (problem) problems[field] = problem
  }
  if (missingAddressAndMapsUrl(values.organizationAddress, values.organizationMapsUrl)) problems.addressGroup = 'required'
  const users = Number(text('approxUsers'))
  if (!text('approxUsers')) problems.approxUsers = 'required'
  else if (!Number.isInteger(users) || users < 1 || users > 100000) problems.approxUsers = 'approxUsers'
  if (text('message').length > 2000) problems.message = 'tooLong'
  return problems
}

/**
 * A field's problem as shown while filling in the form: on leaving it, and while typing once its error
 * shows. "required" waits for Send Request, so an empty field shows nothing here (nor does the Address
 * group: its error only comes from Send Request).
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

/**
 * A request's details as the review page lists them. Position only when the request has one: requests
 * sent before Position was removed may have it; newer ones never do.
 */
export function reviewDetails(request: AccessRequestView): [string, string][] {
  const labels = reviewRequestEn.labels
  return [
    [labels.organization, request.organization],
    [labels.contactName, request.contactName],
    ...(request.jobTitle ? [[labels.jobTitle, request.jobTitle] as [string, string]] : []),
    [labels.email, request.email],
    [labels.phone, request.phone],
    [labels.approxUsers, String(request.approxUsers)],
    [labels.message, request.message || reviewRequestEn.noMessage],
    [labels.received, new Date(request.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
  ]
}
