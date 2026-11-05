import { useEffect, useState } from 'react'
import { OrganizationChart } from '../components/layout/OrganizationChart'
import { Button } from '../components/ui/Button'
import { adminEn } from '../content/admin.en'
import { organizationEn as content } from '../content/organization.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { fetchOrganization, type OrganizationHierarchy } from '../services/organization'
import { useCurrentUser } from '../state/sessionContext'

export type OrganizationLoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; hierarchy: OrganizationHierarchy }

export function OrganizationContent({ state, reload }: { state: OrganizationLoadState; reload: () => void }) {
  if (state.status === 'loading') return (
    <div role="status" aria-label={content.loading} className="mt-8 space-y-8 motion-safe:animate-pulse">
      <span className="sr-only">{content.loading}</span>
      <div className="mx-auto h-20 w-full max-w-64 rounded-xl bg-beige" />
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="h-48 rounded-xl border border-beige bg-white" />)}</div>
    </div>
  )
  if (state.status === 'error') return (
    <div role="alert" className="mt-8 rounded-xl border border-beige bg-white p-6">
      <p className="mb-4 text-text-gray">{content.error}</p>
      <Button variant="secondary" onClick={reload}>{content.retry}</Button>
    </div>
  )
  return <OrganizationChart hierarchy={state.hierarchy} />
}

export function OrganizationalStructurePage() {
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const user = useCurrentUser()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ userId: string; attempt: number; state: OrganizationLoadState } | null>(null)
  const state: OrganizationLoadState = loaded?.userId === user.id && loaded.attempt === attempt ? loaded.state : { status: 'loading' }
  const reload = () => setAttempt((value) => value + 1)
  useEffect(() => {
    let active = true
    fetchOrganization().then(
      (hierarchy) => { if (active) setLoaded({ userId: user.id, attempt, state: { status: 'ready', hierarchy } }) },
      () => { if (active) setLoaded({ userId: user.id, attempt, state: { status: 'error' } }) },
    )
    return () => { active = false }
  }, [user.id, attempt])
  return (
    <div className="min-w-0">
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <OrganizationContent state={state} reload={reload} />
    </div>
  )
}
