import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Info, LoaderCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { HexFragment } from '../components/ui/HexFragment'
import { Logo } from '../components/ui/Logo'
import { PasswordField } from '../components/ui/PasswordField'
import { TextField } from '../components/ui/TextField'
import { signInEn } from '../content/auth.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { signIn, type SignInFailureReason } from '../services/auth'

type Field = 'email' | 'password'
type FieldErrors = Partial<Record<Field, string>>

/** Simple format check: something@something.something, with no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const linkClasses =
  'rounded-sm font-medium text-maroon-secondary underline-offset-4 hover:underline'

/*
 * Links inside the gray legal sentence are always underlined: colour alone would
 * not separate them enough from the surrounding text (WCAG 1.4.1).
 */
const legalLinkClasses =
  'rounded-sm font-medium text-maroon underline decoration-maroon/40 underline-offset-2 hover:decoration-maroon'

/**
 * Sign In page ("/login").
 * Split layout on large screens (brand panel + form); single column below lg.
 * Authentication is not connected yet — see src/services/auth.ts.
 */
export function SignInPage() {
  const content = signInEn
  useDocumentTitle(content.pageTitle)

  const [values, setValues] = useState<Record<Field, string>>({ email: '', password: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const resultMessages: Record<SignInFailureReason, string> = {
    'not-connected': content.results.notConnected,
  }

  /** Returns the error message for a field, or undefined when it is valid. */
  function validateField(field: Field, value: string): string | undefined {
    if (field === 'email') {
      const email = value.trim()
      if (!email) return content.errors.emailRequired
      if (!EMAIL_PATTERN.test(email)) return content.errors.emailInvalid
      return undefined
    }
    // Sign-in only checks that a password was entered (no strength rules).
    return value.length === 0 ? content.errors.passwordRequired : undefined
  }

  function handleChange(field: Field, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  // Errors are first shown on submit; after that, each field re-validates on blur.
  function handleBlur(field: Field) {
    if (!submitAttempted) return
    setErrors((prev) => ({ ...prev, [field]: validateField(field, values[field]) }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setSubmitAttempted(true)
    const nextErrors: FieldErrors = {
      email: validateField('email', values.email),
      password: validateField('password', values.password),
    }

    // Render the error messages before moving focus, so screen readers
    // announce the field together with its error.
    flushSync(() => setErrors(nextErrors))

    const firstInvalid = (['email', 'password'] as const).find((field) => nextErrors[field])
    if (firstInvalid) {
      const fieldRefs = { email: emailRef, password: passwordRef }
      fieldRefs[firstInvalid].current?.focus()
      return
    }

    setStatusMessage('')
    setSubmitting(true)
    const result = await signIn(values.email.trim(), values.password)
    setSubmitting(false)

    // No navigation yet: show the result inline.
    if (!result.ok) setStatusMessage(resultMessages[result.reason])
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-offwhite lg:flex lg:items-center lg:justify-center lg:px-10 lg:py-12">
      {/* Very subtle page-level hexagon pattern (large screens, behind the card) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
        <HexFragment className="absolute -top-40 -left-40 size-[34rem] text-maroon/[0.035]" strokeWidth={2} />
        <HexFragment open={false} className="absolute -right-32 -bottom-48 size-[38rem] text-maroon/[0.035]" strokeWidth={2} />
      </div>

      {/* Card: split on lg+, plain single column below lg */}
      <div className="relative w-full lg:grid lg:max-w-[1100px] lg:min-h-[640px] lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] lg:overflow-hidden lg:rounded-2xl lg:border lg:border-beige lg:bg-white lg:shadow-[0_24px_64px_-28px_rgba(58,11,24,0.25)]">
        {/* Brand panel — large screens only */}
        <div className="relative hidden flex-col overflow-hidden bg-beige lg:flex">
          {/* Hexagon outlines echoing the logo: one large off the bottom-left corner, one small at top right */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <HexFragment className="absolute -bottom-28 -left-28 size-[28rem] text-maroon/[0.09]" strokeWidth={3} />
            <HexFragment open={false} className="absolute -top-12 -right-12 size-44 text-maroon/[0.08]" strokeWidth={3} />
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center px-10 pt-14 text-center">
            <Link to="/" className="rounded-md">
              {/* h-60 ≈ 200px wide at the logo's aspect ratio */}
              <Logo variant="full" alt={content.brand.logoAlt} className="h-60" />
            </Link>
            <span aria-hidden="true" className="mt-8 block h-0.5 w-10 bg-gold" />
            <p className="mt-6 text-lg leading-relaxed text-text-gray">
              {content.brand.taglineLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </div>

          <p className="relative px-10 pt-6 pb-10 text-center text-[13px] leading-relaxed text-text-gray">
            {content.brand.regulatoryNote}
          </p>
        </div>

        {/* Form panel */}
        <div className="flex flex-col px-4 pt-6 pb-10 sm:px-8 lg:justify-center lg:bg-white lg:px-16 lg:py-14">
          <div className="mx-auto w-full max-w-md">
            {/* Compact logo — small screens only */}
            <Link to="/" className="inline-block rounded-md lg:hidden">
              <Logo variant="mark" alt={content.brand.logoAlt} className="h-12" />
            </Link>

            <h1 className="mt-8 text-[2rem] leading-tight font-semibold tracking-tight lg:mt-0 lg:text-4xl">
              {content.title}
            </h1>
            <p className="mt-2 text-text-gray">{content.subtitle}</p>

            <form noValidate onSubmit={handleSubmit} className="mt-8">
              <TextField
                ref={emailRef}
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                label={content.email.label}
                placeholder={content.email.placeholder}
                value={values.email}
                error={errors.email}
                onChange={(e) => handleChange('email', e.target.value)}
                onBlur={() => handleBlur('email')}
              />

              <PasswordField
                ref={passwordRef}
                name="password"
                autoComplete="current-password"
                label={content.password.label}
                placeholder={content.password.placeholder}
                showLabel={content.password.showLabel}
                hideLabel={content.password.hideLabel}
                value={values.password}
                error={errors.password}
                onChange={(e) => handleChange('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                className="mt-5"
              />

              <div className="mt-2 flex justify-end">
                <Link to={content.forgotPassword.href} className={`text-sm ${linkClasses}`}>
                  {content.forgotPassword.label}
                </Link>
              </div>

              {/* Live region stays mounted so screen readers announce new messages */}
              <div role="status">
                {statusMessage && (
                  <p className="mt-6 flex items-start gap-2.5 rounded-lg border border-gold-light bg-beige p-3.5 text-sm leading-relaxed text-maroon">
                    <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon-secondary" strokeWidth={1.75} />
                    {statusMessage}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                aria-disabled={submitting || undefined}
                className="mt-6 w-full"
              >
                {submitting && (
                  <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" strokeWidth={1.75} />
                )}
                {submitting ? content.submit.loadingLabel : content.submit.label}
              </Button>

              {/* TODO: /terms and /privacy don't exist yet — the documents still need to be written. */}
              <p className="mt-6 text-center text-xs leading-relaxed text-text-gray">
                {content.legal.prefix}
                <Link to={content.legal.terms.href} className={legalLinkClasses}>
                  {content.legal.terms.label}
                </Link>
                {content.legal.conjunction}
                <Link to={content.legal.privacy.href} className={legalLinkClasses}>
                  {content.legal.privacy.label}
                </Link>
                {content.legal.suffix}
              </p>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
