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
    <main className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* Brand panel — large screens only */}
      <div className="relative hidden overflow-hidden border-r border-beige bg-gradient-to-b from-offwhite to-beige lg:flex lg:flex-col">
        {/* Soft hexagon pattern echoing the logo */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <HexFragment className="absolute -bottom-28 -left-28 size-[30rem] text-maroon/[0.06]" strokeWidth={2} />
          <HexFragment
            open={false}
            className="absolute -bottom-6 left-16 size-72 text-maroon/[0.05]"
            strokeWidth={2}
          />
          <HexFragment className="absolute -top-16 -right-20 size-64 text-maroon/[0.04]" strokeWidth={2} />
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center px-10 text-center">
          <Link to="/" className="rounded-md">
            <Logo variant="full" alt={content.brand.logoAlt} className="h-36 xl:h-40" />
          </Link>
          <p className="mt-8 max-w-[15rem] text-lg leading-relaxed text-balance text-text-gray">{content.brand.tagline}</p>
        </div>

        <p className="relative max-w-xs px-10 pb-10 text-xs leading-relaxed text-text-gray">
          {content.brand.regulatoryNote}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex min-h-dvh flex-col px-4 sm:px-8 lg:px-16">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
          {/* Compact logo — small screens only */}
          <div className="pt-8 lg:hidden">
            <Link to="/" className="inline-block rounded-md">
              <Logo variant="mark" alt={content.brand.logoAlt} className="h-12" />
            </Link>
          </div>

          <div className="flex flex-1 flex-col justify-center py-10">
            <h1 className="text-3xl tracking-tight">{content.title}</h1>
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
            </form>
          </div>

          {/* TODO: /terms and /privacy don't exist yet — the documents still need to be written. */}
          <p className="pb-8 text-xs leading-relaxed text-text-gray">
            {content.legal.prefix}
            <Link to={content.legal.terms.href} className={linkClasses}>
              {content.legal.terms.label}
            </Link>
            {content.legal.conjunction}
            <Link to={content.legal.privacy.href} className={linkClasses}>
              {content.legal.privacy.label}
            </Link>
            {content.legal.suffix}
          </p>
        </div>
      </div>
    </main>
  )
}
