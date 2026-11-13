import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { GuidelineProcessingCard } from '../../components/admin/GuidelineProcessingCard'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { CurrentBadge } from '../../components/ui/CurrentBadge'
import { GuidelineVersionView } from '../../components/ui/GuidelineVersionView'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { newestVersion } from '../../lib/guidelines'
import { GuidelineError } from '../../services/guidelines'
import { useGuidelines } from '../../state/guidelinesContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminRegulationsLocationState } from './AdminRegulationsPage'

/**
 * A GVP version ("/admin/regulations/:id", PBI 20): its details; its requirements, shown from the
 * details' count; and its PDF in a card of its own, through a signed link, when it has one
 * (GuidelineVersionView). The newest version shows the Current badge, as on the SFDA Regulatory
 * Requirements tab (display only). An added version also shows its processing card (phase 2) and
 * Delete, as on the list: deleting one being processed cancels its processing.
 */
export function RegulationDetailsPage() {
  const { id } = useParams()
  const text = adminEn.regulationDetails
  const names = adminEn.regulations
  const { getVersion, current, allVersions, retryProcessing, makeCurrent, deleteVersion } = useGuidelines()
  const navigate = useNavigate()
  const version = getVersion(id)
  const shownCurrent = newestVersion(allVersions, current)
  const name = version ? names.versionName.replace('{version}', version.version) : ''
  useDocumentTitle(version ? adminEn.pageTitle.replace('{page}', name) : undefined)

  // The added version this page saw waiting or being processed (its polling is on).
  const [watchedId, setWatchedId] = useState<string>()
  const inProgress = version?.processing?.status === 'waiting' || version?.processing?.status === 'processing'
  if (version && inProgress && watchedId !== version.id) setWatchedId(version.id)

  // Delete (added versions only), confirmed in a dialog. While deleting, the version leaves the
  // lists before deleteVersion resolves: the page shows nothing until it moves to the list.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [refusal, setRefusal] = useState('')
  const deleteButton = useRef<HTMLButtonElement>(null)
  const label = version ? names.versionLabel.replace('{title}', version.title ?? '').replace('{version}', version.version) : ''

  async function confirmDelete() {
    if (!version?.neverCurrent || removing) return
    const deletedLabel = label
    setConfirmingDelete(false)
    setRemoving(true)
    setRefusal('')
    let outcome: 'deleted' | 'cancelled'
    try {
      outcome = await deleteVersion(version.id)
    } catch (error) {
      // The dialog opens again with the reason.
      setRemoving(false)
      const permission = error instanceof GuidelineError && error.reason === 'permission'
      setRefusal(permission ? names.deleteDialog.permission : names.deleteDialog.failed)
      setConfirmingDelete(true)
      return
    }
    // Being processed: its processing stops and the compliance service deletes it (polling stops with the page).
    const state: AdminRegulationsLocationState = outcome === 'cancelled' ? { cancelled: true } : { deleted: names.deleted.replace('{name}', deletedLabel) }
    navigate(text.back.href, { replace: true, state })
  }

  if (!version && removing) return null
  // An added version that finished processing became a published version (it is current now): go there.
  const published = !version && id ? allVersions.find((item) => item.fromDraftId === id) : undefined
  if (published) return <Navigate to={`${text.back.href}/${published.id}`} replace />
  // Gone while waiting or being processed, without being published: it was deleted (its processing
  // cancelled). Polling stops with it; the list says so.
  if (!version && id && watchedId === id) {
    const state: AdminRegulationsLocationState = { cancelled: true }
    return <Navigate to={text.back.href} replace state={state} />
  }
  if (!version) return <NotFoundPage embedded />

  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl tracking-tight sm:text-3xl">{name}</h1>
        {version.id === shownCurrent.id && <CurrentBadge label={names.current.badge} />}
        {version.neverCurrent && (
          <Button
            ref={deleteButton}
            variant="danger"
            className="sm:ml-auto"
            aria-label={names.actions.delete.replace('{name}', label)}
            aria-disabled={removing || undefined}
            onClick={() => {
              if (removing) return
              setRefusal('')
              setConfirmingDelete(true)
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {names.deleteDialog.confirm}
          </Button>
        )}
      </div>

      {/* An added version: processing by the compliance service, then Make Current (GVP phase 2) */}
      {version.neverCurrent && version.processing && (
        <GuidelineProcessingCard
          version={version}
          onRetry={() => retryProcessing(version.id)}
          onMakeCurrent={async () => {
            const newId = await makeCurrent(version.id)
            // The added version became a published one with a new id.
            if (newId) navigate(`${text.back.href}/${newId}`, { replace: true })
          }}
        />
      )}

      {/* A new view for each version, so the requirements start closed */}
      <GuidelineVersionView key={version.id} version={version} />

      {version.neverCurrent && (
        <ConfirmDialog
          open={confirmingDelete}
          title={names.deleteDialog.title}
          description={names.deleteDialog.description.replace('{name}', label)}
          cancelLabel={names.deleteDialog.cancel}
          confirmLabel={names.deleteDialog.confirm}
          error={refusal || undefined}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setConfirmingDelete(false)
            setRefusal('')
            deleteButton.current?.focus()
          }}
        />
      )}
    </>
  )
}
