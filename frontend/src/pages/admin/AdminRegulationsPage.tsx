import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { CircleCheck, Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { GuidelineVersionDetails } from '../../components/admin/GuidelineVersionDetails'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { IconButton } from '../../components/ui/IconButton'
import { tableStyles } from '../../components/ui/tableStyles'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatDate } from '../../lib/format'
import { addedDateOf, deleteVersionBlocker } from '../../lib/guidelines'
import { adminRegulationEditPath, adminRegulationPath } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'

/** Set after adding a version (its number) or editing one (the notice), to say so here. */
export interface AdminRegulationsLocationState {
  added?: string
  updated?: string
}

/**
 * SFDA Regulatory Requirements ("/admin/regulations", PBI 20): the current GVP version, every version
 * in a Version History table (newest first: the current one is the first row) with View, Edit and
 * Delete, and "Add new version". Editing and deleting only change this tab's copy.
 */
export function AdminRegulationsPage() {
  const text = adminEn.regulations
  const columns = text.history.columns
  useDocumentTitle(adminEn.pageTitle.replace('{page}', text.title))
  const arrived = useLocation().state as AdminRegulationsLocationState | null
  const navigate = useNavigate()
  const { versions, current, deleteVersion } = useGuidelines()
  const { sops } = useSops()
  const { users } = useUsers()
  const admin = useCurrentUser()
  const history = [...versions].reverse()

  const [notice, setNotice] = useState(() => (arrived?.added ? text.added.replace('{version}', arrived.added) : arrived?.updated ?? ''))
  const [deleting, setDeleting] = useState<GuidelineVersion>()
  const [refusal, setRefusal] = useState('')
  const noticeRef = useRef<HTMLDivElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)

  const label = (version: GuidelineVersion) => text.versionLabel.replace('{title}', version.title ?? '').replace('{version}', version.version)
  const date = (isoDate: string | undefined): ReactNode => (isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : text.none)
  const currentBadge = (
    <span className="rounded-full border border-maroon/20 bg-maroon/[0.06] px-2.5 py-0.5 text-xs font-medium text-maroon">{text.current.badge}</span>
  )
  const versionCell = (version: GuidelineVersion) => (
    // The badge stays on the version's line.
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {version.version}
      {version.id === current.id && currentBadge}
    </span>
  )
  const actions = (version: GuidelineVersion) => (
    <div className="flex justify-end gap-1">
      <IconButton label={text.actions.view.replace('{name}', label(version))} icon={Eye} onClick={() => navigate(adminRegulationPath(version.id))} />
      <IconButton label={text.actions.edit.replace('{name}', label(version))} icon={Pencil} onClick={() => navigate(adminRegulationEditPath(version.id))} />
      <IconButton
        label={text.actions.delete.replace('{name}', label(version))}
        icon={Trash2}
        danger
        onClick={(event) => {
          deleteTrigger.current = event.currentTarget
          setRefusal('')
          setDeleting(version)
        }}
      />
    </div>
  )

  /** Refuses the current version and versions SOPs were checked against; the dialog then stays open. */
  function canDelete(): boolean {
    if (!deleting) return false
    const blocker = deleteVersionBlocker(deleting, versions, sops)
    if (!blocker) return true
    setRefusal(text.deleteDialog[blocker])
    return false
  }

  function confirmDelete() {
    if (!deleting) return
    const name = label(deleting)
    deleteVersion(deleting.id, { actorId: admin.id, users, sops })
    flushSync(() => {
      setDeleting(undefined)
      setNotice(text.deleted.replace('{name}', name))
    })
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
        <Button to={text.addVersion.href} className="shrink-0 self-start sm:self-auto">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {text.addVersion.label}
        </Button>
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
            {text.versionName.replace('{version}', current.version)}
            {currentBadge}
          </p>
          <GuidelineVersionDetails version={current} actions={{ withoutFile: true }} className="mt-5" />
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="text-lg">
            {text.history.title}
          </h2>
          <div className={`mt-3 ${tableStyles.frame}`}>
            {/* Table — md and up */}
            <div className={tableStyles.wide}>
              <table aria-label={text.history.tableLabel} className={tableStyles.table}>
                <thead className={tableStyles.head}>
                  <tr>
                    <th scope="col" className={tableStyles.headCell}>{columns.title}</th>
                    <th scope="col" className={`${tableStyles.headCell} whitespace-nowrap`}>{columns.version}</th>
                    <th scope="col" className={`${tableStyles.headCell} whitespace-nowrap`}>{columns.issued}</th>
                    <th scope="col" className={`${tableStyles.headCell} whitespace-nowrap`}>{columns.added}</th>
                    <th scope="col" className={`${tableStyles.headCell} text-right`}>
                      <span className="sr-only">{columns.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={tableStyles.body}>
                  {history.map((version) => (
                    <tr key={version.id}>
                      <th scope="row" className={tableStyles.rowHeader}>{version.title || text.none}</th>
                      <td className={`${tableStyles.cell} whitespace-nowrap text-maroon`}>{versionCell(version)}</td>
                      <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{date(version.issuedDate)}</td>
                      <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{date(version.addedAt ? addedDateOf(version) : undefined)}</td>
                      <td className={tableStyles.cell}>{actions(version)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stacked cards — below md */}
            <ul aria-label={text.history.tableLabel} className={tableStyles.cards}>
              {history.map((version) => (
                <li key={version.id} className="p-4">
                  <p className="text-sm font-medium break-words text-maroon">{version.title || text.none}</p>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
                    <dt className="text-text-gray">{columns.version}</dt>
                    <dd className="text-maroon">{versionCell(version)}</dd>
                    <dt className="text-text-gray">{columns.issued}</dt>
                    <dd className="text-maroon">{date(version.issuedDate)}</dd>
                    <dt className="text-text-gray">{columns.added}</dt>
                    <dd className="text-maroon">{date(version.addedAt ? addedDateOf(version) : undefined)}</dd>
                  </dl>
                  <div className="mt-3 flex justify-end">{actions(version)}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title={text.deleteDialog.title}
        description={deleting ? text.deleteDialog.description.replace('{name}', label(deleting)) : ''}
        cancelLabel={text.deleteDialog.cancel}
        confirmLabel={text.deleteDialog.confirm}
        error={refusal || undefined}
        canConfirm={canDelete}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleting(undefined)
          setRefusal('')
          deleteTrigger.current?.focus()
        }}
      />
    </>
  )
}
