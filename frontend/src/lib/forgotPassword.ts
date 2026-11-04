import { forgotPasswordEn } from '../content/auth.en'
import { EMAIL_PATTERN } from './userAdmin'

const content = forgotPasswordEn

/** The email problem to show, or undefined when the address can be sent. */
export function forgotEmailProblem(value: string): string | undefined {
  const email = value.trim()
  if (!email) return content.errors.emailRequired
  if (!EMAIL_PATTERN.test(email)) return content.errors.emailInvalid
  return undefined
}
