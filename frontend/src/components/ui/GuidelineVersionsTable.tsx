import type { ReactNode } from 'react'
import { ProcessingStatusBadge } from './ProcessingStatusBadge'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { addedDateOf } from '../../lib/guidelines'
import { CurrentBadge } from './CurrentBadge'
import { tableStyles } from './tableStyles'

/**
 * GVP versions as the admin's Version History shows them: Title, Version (with the Current badge on
 * `currentId`), Issued by SFDA On and Added to Hawkim On, and each row's `actions`; a table from md,
 * stacked cards below. Used by the SFDA Regulatory Requirements tab (every version, View, Edit and
 * Delete) and the author's Compliance Overview (the version compliance checks use, View only).
 */
export function GuidelineVersionsTable({
  versions,
  currentId,
  label,
  actions,
  className = '',
}: {
  versions: GuidelineVersion[]
  currentId: string
  /** Names the table (and the stacked list) for screen readers. */
  label: string
  actions: (version: GuidelineVersion) => ReactNode
  /** Classes in front of the frame's (e.g. its margin). */
  className?: string
}) {
  const text = adminEn.regulations
  const columns = text.history.columns
  const date = (isoDate: string | undefined): ReactNode => (isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : text.none)
  const versionCell = (version: GuidelineVersion) => (
    // The badge stays on the version's line.
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {version.version}
      {version.id === currentId && <CurrentBadge label={text.current.badge} />}
      {version.neverCurrent && version.processing && <ProcessingStatusBadge status={version.processing.status} />}
    </span>
  )

  return (
    <div className={className ? `${className} ${tableStyles.frame}` : tableStyles.frame}>
      {/* Table — md and up */}
      <div className={tableStyles.wide}>
        <table aria-label={label} className={tableStyles.table}>
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
            {versions.map((version) => (
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
      <ul aria-label={label} className={tableStyles.cards}>
        {versions.map((version) => (
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
  )
}
