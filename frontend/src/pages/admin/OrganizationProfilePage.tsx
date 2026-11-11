import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { CircleCheck, ExternalLink, Info, LoaderCircle, Pencil } from 'lucide-react'
import { EmailDetail } from '../../components/admin/DetailsCard'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { TextAreaField } from '../../components/ui/TextAreaField'
import { TextField } from '../../components/ui/TextField'
import { UnsavedChangesGuard } from '../../components/ui/UnsavedChangesGuard'
import { organizationProfileEn as content } from '../../content/organizationProfile.en'
import type { OrganizationProfileField } from '../../content/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useSuperAdmin } from '../../hooks/useSuperAdmin'
import {
  fetchOrganizationProfile,
  ORGANIZATION_PROFILE_FIELDS,
  ORGANIZATION_PROFILE_MAX,
  OrganizationProfileError,
  organizationProfileProblems,
  saveOrganizationProfile,
  type OrganizationProfile,
  type OrganizationProfileProblem,
} from '../../services/organizationProfile'
import { useCurrentUser } from '../../state/sessionContext'

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; profile: OrganizationProfile }

/**
 * Organization Profile ("/admin/organization-profile"): the organization's name, email, description, address,
 * Google Maps link and website, from the database (organization_settings; nothing is invented or filled in).
 * Every Admin sees them; the Super Admin also gets Edit, which turns the card into a form with the same six
 * values (all required, the email and the two links checked) and Save Changes / Cancel. The Address and the
 * Google Maps Link are two separate values in ONE Address box, side by side (stacked on narrow screens).
 * Saving sends all six to the database, each to its own column, then shows what was stored; a refused save
 * keeps what was typed and says why. Leaving with unsaved changes asks first.
 */
export function OrganizationProfilePage() {
  useDocumentTitle(content.pageTitle)
  const viewer = useCurrentUser()
  const superAdmin = useSuperAdmin()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    fetchOrganizationProfile().then(
      (profile) => active && setLoad({ status: 'ready', profile }),
      () => active && setLoad({ status: 'error' }),
    )
    return () => {
      active = false
    }
  }, [attempt])

  const canEdit = superAdmin.status === 'ready' && superAdmin.superAdminId === viewer.id

  function saved(profile: OrganizationProfile) {
    setLoad({ status: 'ready', profile })
    setEditing(false)
    flushSync(() => setNotice(content.saved))
    noticeRef.current?.focus()
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 max-w-2xl text-text-gray">{content.subtitle}</p>

      <div role="status" ref={noticeRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {notice && (
          <p className="mt-6 flex max-w-3xl items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
      </div>

      {load.status === 'loading' ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm font-medium text-text-gray">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
          {content.loading}
        </p>
      ) : load.status === 'error' ? (
        <div role="alert" className="mt-6 flex max-w-3xl flex-wrap items-center gap-3 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg">
          <span className="font-medium">{content.loadFailed}</span>
          <Button variant="secondary" size="sm" onClick={() => { setLoad({ status: 'loading' }); setAttempt((count) => count + 1) }}>
            {content.retry}
          </Button>
        </div>
      ) : (
        <section aria-labelledby="organization-profile-title" className="mt-6 max-w-3xl rounded-xl border border-beige bg-white p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="organization-profile-title" className="text-lg">{content.detailsTitle}</h2>
            {canEdit && !editing && (
              <Button ref={editRef} size="sm" onClick={() => { setNotice(''); setEditing(true) }}>
                <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
                {content.edit}
              </Button>
            )}
          </div>
          {editing ? (
            <ProfileForm
              initial={load.profile}
              onSaved={saved}
              onCancel={() => {
                setEditing(false)
                // After the form is gone, focus Edit again.
                requestAnimationFrame(() => editRef.current?.focus())
              }}
            />
          ) : (
            <ProfileView profile={load.profile} />
          )}
          {!canEdit && superAdmin.status === 'ready' && (
            <p className="mt-5 flex items-start gap-2 border-t border-beige pt-4 text-sm text-text-gray">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon" strokeWidth={1.75} />
              {content.readOnly}
            </p>
          )}
        </section>
      )}
    </>
  )
}

/** A label and its value, as on a staff member's page (14px bold maroon label, 16px maroon value). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-6">
      <dt className="text-sm font-bold text-maroon">{label}</dt>
      <dd className="min-w-0 text-base break-words text-maroon">{children}</dd>
    </div>
  )
}

/** A saved link, opened in a new tab (its full address is shown); "Not set" when there is none. */
function LinkValue({ href, label }: { href: string; label: string }) {
  if (!href) return <span className="text-text-gray">{content.notSet}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={content.opensInNewTab.replace('{label}', label)}
      className="inline-flex max-w-full items-start gap-1 rounded-sm break-all text-maroon underline underline-offset-2 hover:text-maroon-secondary">
      {href}
      <ExternalLink aria-hidden="true" className="mt-1 size-3.5 shrink-0" strokeWidth={1.75} />
    </a>
  )
}

export function ProfileView({ profile }: { profile: OrganizationProfile }) {
  const notSet = <span className="text-text-gray">{content.notSet}</span>
  return (
    <dl className="divide-y divide-beige">
      <Row label={content.fields.name.label}>{profile.name || notSet}</Row>
      <Row label={content.fields.email.label}>
        {profile.email
          ? <EmailDetail email={profile.email} copyLabel={content.copyEmail} copiedText={content.copied} failedText={content.copyFailed} />
          : notSet}
      </Row>
      <Row label={content.fields.description.label}>
        {profile.description ? <span className="whitespace-pre-line">{profile.description}</span> : notSet}
      </Row>
      {/* ONE Address box: the address and the Google Maps link side by side (stacked on phones). */}
      <div className="py-3">
        <dt className="text-sm font-bold text-maroon">{content.addressTitle}</dt>
        <dd className="mt-2">
          <dl className="grid gap-4 rounded-lg border border-beige p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm font-medium text-text-gray">{content.fields.address.label}</dt>
              <dd className="mt-1 text-base break-words text-maroon">{profile.address || notSet}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-text-gray">{content.fields.mapsUrl.label}</dt>
              <dd className="mt-1 text-base"><LinkValue href={profile.mapsUrl} label={content.fields.mapsUrl.label} /></dd>
            </div>
          </dl>
        </dd>
      </div>
      <Row label={content.fields.website.label}><LinkValue href={profile.website} label={content.fields.website.label} /></Row>
    </dl>
  )
}

/** The message for a value's problem. */
function problemText(field: OrganizationProfileField, problem: OrganizationProfileProblem): string {
  if (problem === 'required') return content.errors.required[field]
  if (problem === 'email') return content.errors.emailInvalid
  if (problem === 'url') return content.errors.urlInvalid
  return content.errors.tooLong.replace('{max}', String(ORGANIZATION_PROFILE_MAX[field]))
}

export function ProfileForm({ initial, onSaved, onCancel }: { initial: OrganizationProfile; onSaved: (profile: OrganizationProfile) => void; onCancel: () => void }) {
  const [values, setValues] = useState<OrganizationProfile>(initial)
  const [errors, setErrors] = useState<Partial<Record<OrganizationProfileField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  // Cancel with unsaved changes asks first (as leaving the page does).
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const refs = useRef<Partial<Record<OrganizationProfileField, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const refusedRef = useRef<HTMLDivElement>(null)
  const dirty = ORGANIZATION_PROFILE_FIELDS.some((field) => values[field] !== initial[field])

  const change = (field: OrganizationProfileField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const problems = organizationProfileProblems(values)
    const found = Object.fromEntries(
      ORGANIZATION_PROFILE_FIELDS.filter((field) => problems[field]).map((field) => [field, problemText(field, problems[field]!)]),
    ) as Partial<Record<OrganizationProfileField, string>>
    setErrors(found)
    const first = ORGANIZATION_PROFILE_FIELDS.find((field) => found[field])
    if (first) {
      refs.current[first]?.focus()
      return
    }
    setBusy(true)
    setRefused(undefined)
    try {
      const saved = await saveOrganizationProfile(values)
      onSaved(saved)
    } catch (error) {
      // What was typed stays in the form.
      setBusy(false)
      flushSync(() => setRefused(content.failures[error instanceof OrganizationProfileError ? error.reason : 'failed']))
      refusedRef.current?.focus()
    }
  }

  const field = (name: OrganizationProfileField) => ({
    name,
    label: content.fields[name].label,
    placeholder: content.fields[name].placeholder,
    hint: content.fields[name].hint,
    required: true,
    requiredMark: true,
    maxLength: ORGANIZATION_PROFILE_MAX[name],
    value: values[name],
    error: errors[name],
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-5">
      {refused && <RefusedBox ref={refusedRef} title={content.notSaved} messages={[refused]} />}
      <TextField {...field('name')} ref={(element) => { refs.current.name = element }} autoComplete="organization"
        onChange={(event) => change('name')(event.target.value)} />
      <TextField {...field('email')} ref={(element) => { refs.current.email = element }} type="email" autoComplete="email" spellCheck={false}
        onChange={(event) => change('email')(event.target.value)} />
      <TextAreaField {...field('description')} ref={(element) => { refs.current.description = element }} rows={4}
        onChange={(event) => change('description')(event.target.value)} />
      {/* ONE Address box: two separate, separately saved values side by side (stacked on phones). */}
      <fieldset className="rounded-lg border border-beige p-4">
        <legend className="px-1 text-sm font-bold text-maroon">{content.addressTitle}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField {...field('address')} ref={(element) => { refs.current.address = element }} autoComplete="street-address"
            onChange={(event) => change('address')(event.target.value)} />
          <TextField {...field('mapsUrl')} ref={(element) => { refs.current.mapsUrl = element }} type="url" inputMode="url" spellCheck={false}
            onChange={(event) => change('mapsUrl')(event.target.value)} />
        </div>
      </fieldset>
      <TextField {...field('website')} ref={(element) => { refs.current.website = element }} type="url" inputMode="url" autoComplete="url" spellCheck={false}
        onChange={(event) => change('website')(event.target.value)} />
      <div className="flex flex-col-reverse gap-3 border-t border-beige pt-5 sm:flex-row sm:justify-end">
        <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => { if (!busy) { if (dirty) setConfirmingCancel(true); else onCancel() } }}>{content.cancel}</Button>
        <Button type="submit" aria-disabled={busy || undefined}>
          {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
          {busy ? content.saving : content.save}
        </Button>
      </div>
      <UnsavedChangesGuard when={dirty && !busy} text={content.discard} />
      <ConfirmDialog open={confirmingCancel} title={content.discard.title} description={content.discard.description}
        cancelLabel={content.discard.keep} confirmLabel={content.discard.discard}
        onConfirm={() => { setConfirmingCancel(false); onCancel() }} onCancel={() => setConfirmingCancel(false)} />
    </form>
  )
}
