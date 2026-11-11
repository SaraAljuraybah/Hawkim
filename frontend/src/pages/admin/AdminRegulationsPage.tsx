import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { CircleAlert, CircleCheck, Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { CurrentBadge } from '../../components/ui/CurrentBadge'
import { GuidelineVersionsTable } from '../../components/ui/GuidelineVersionsTable'
import { IconButton } from '../../components/ui/IconButton'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { newestVersion, versionInProgress } from '../../lib/guidelines'
import { adminRegulationEditPath, adminRegulationPath } from '../../lib/routes'
import { GuidelineError } from '../../services/guidelines'
import { useGuidelines } from '../../state/guidelinesContext'

/** Set after adding a version (its number) or editing one (the notice), to say so here. */
export interface AdminRegulationsLocationState {
  added?: string
  updated?: string
}

/**
 * SFDA Regulatory Requirements ("/admin/regulations", PBI 20): the Current Version card, every version in a Version History table (newest first by
 * when it was added, the versions admins added included) with View and Edit, Delete for a version
 * that was never current, and "Add new version".
 * Here the newest version shows as current (display only, `newestVersion`); Delete follows the
 * database's current version, like compliance checks and every other page.
 */
export function AdminRegulationsPage() {
  const text = adminEn.regulations
  useDocumentTitle(adminEn.pageTitle.replace('{page}', text.title))
  const arrived = useLocation().state as AdminRegulationsLocationState | null
  const navigate = useNavigate()
  const { allVersions, addedStatus, retryAdded, current, deleteVersion } = useGuidelines()
  const inProgress = versionInProgress(allVersions)
  const history = [...allVersions].reverse()
  const shownCurrent = newestVersion(allVersions, current)

  const [notice, setNotice] = useState(() => (arrived?.added ? text.added.replace('{version}', arrived.added) : arrived?.updated ?? ''))
  const [deleting, setDeleting] = useState<GuidelineVersion>()
  const [refusal, setRefusal] = useState('')
  // One version at a time: Add New Version explains why it has to wait while another is processing.
  const [explainingWait, setExplainingWait] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)

  const label = (version: GuidelineVersion) => text.versionLabel.replace('{title}', version.title ?? '').replace('{version}', version.version)
  // Each action on its own, for its column in the table (the cards show them together).
  const actions = (version: GuidelineVersion) => ({
    preview: <IconButton label={text.actions.view.replace('{name}', label(version))} icon={Eye} onClick={() => navigate(adminRegulationPath(version.id))} />,
    edit: <IconButton label={text.actions.edit.replace('{name}', label(version))} icon={Pencil} onClick={() => navigate(adminRegulationEditPath(version.id))} />,
    // Only a version that was never current can be deleted; on the others Delete is disabled, saying why.
    delete: (
      <IconButton
        label={text.actions.delete.replace('{name}', label(version))}
        icon={Trash2}
        danger
        disabledReason={deleteBlocked(version)}
        onClick={(event) => {
          if (!version.neverCurrent) return
          deleteTrigger.current = event.currentTarget
          setRefusal('')
          setDeleting(version)
        }}
      />
    ),
  })

  /** Why a version can't be deleted: it is current in the database, or was current before (and so used for checks). */
  function deleteBlocked(version: GuidelineVersion): string | undefined {
    if (version.neverCurrent) return undefined
    return version.id === current.id ? text.deleteBlocked.current : text.deleteBlocked.used
  }

  /** Deletes it in the database; if that fails, the dialog opens again with the reason. */
  async function confirmDelete() {
    if (!deleting?.neverCurrent) return
    const version = deleting
    const name = label(version)
    setDeleting(undefined)
    try {
      await deleteVersion(version.id)
    } catch (error) {
      const permission = error instanceof GuidelineError && error.reason === 'permission'
      setRefusal(permission ? text.deleteDialog.permission : text.deleteDialog.failed)
      setDeleting(version)
      return
    }
    flushSync(() => setNotice(text.deleted.replace('{name}', name)))
    // The row is gone: focus the notice.
    noticeRef.current?.focus()
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{text.title}</h1>
          <p className="mt-2 text-text-gray">{text.subtitle}</p>
        </div>
        {inProgress ? (
          <Button onClick={() => setExplainingWait(true)} className="shrink-0 self-start sm:self-auto">
            <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
            {text.addVersion.label}
          </Button>
        ) : (
          <Button to={text.addVersion.href} className="shrink-0 self-start sm:self-auto">
            <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
            {text.addVersion.label}
          </Button>
        )}
      </div>

      <div role="status" ref={noticeRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
      </div>

      <div className="mt-8 grid gap-8">
        <section aria-labelledby="current-title" className="max-w-4xl rounded-xl border border-beige bg-white p-5 sm:p-6">
          <h2 id="current-title" className="text-sm font-semibold tracking-wide text-text-gray uppercase">
            {text.current.title}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-xl font-semibold text-maroon">
            {text.versionName.replace('{version}', shownCurrent.version)}
            <CurrentBadge label={text.current.badge} />
          </p>
          <GuidelineVersionDetails version={shownCurrent} actions={{ withoutFile: true, withoutRequirements: true }} className="mt-5" />
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="text-lg">
            {text.history.title}
          </h2>
          {/* The published versions are still listed below; only the added ones are missing. */}
          {addedStatus === 'error' && (
            <div
              role="alert"
              className="mt-3 flex flex-col gap-3 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                {text.addedLoadFailed.text}
              </p>
              <Button variant="secondary" onClick={retryAdded} className="shrink-0 self-start sm:self-auto">
                {text.addedLoadFailed.retry}
              </Button>
            </div>
          )}
          <GuidelineVersionsTable versions={history} currentId={shownCurrent.id} label={text.history.tableLabel} actions={actions} className="mt-3" />
        </section>
      </div>

      <ConfirmDialog
        open={explainingWait && !!inProgress}
        title={text.inProgress.title}
        description={inProgress ? text.inProgress.text.replace('{version}', inProgress.version) : ''}
        cancelLabel={text.inProgress.close}
        confirmLabel={inProgress ? text.inProgress.view.replace('{version}', inProgress.version) : ''}
        onConfirm={() => {
          setExplainingWait(false)
          if (inProgress) navigate(adminRegulationPath(inProgress.id))
        }}
        onCancel={() => setExplainingWait(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        title={text.deleteDialog.title}
        description={deleting ? text.deleteDialog.description.replace('{name}', label(deleting)) : ''}
        cancelLabel={text.deleteDialog.cancel}
        confirmLabel={text.deleteDialog.confirm}
        error={refusal || undefined}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleting(undefined)
          setRefusal('')
          deleteTrigger.current?.focus()
        }}
      />
    </>
  )
}
