import type { ReactNode } from 'react'
import type { Requirement } from '../../data/mock/types'
import { tableStyles } from './tableStyles'

/** The labels of a requirements table, from the page's content file. */
export interface RequirementsTableLabels {
  /** The accessible name of the table and of the card list. */
  tableLabel: string
  columns: { id: string; module: string; section: string; title: string; page: string; summary: string }
  /** `{page}` is replaced. */
  page: string
  /** If given, shown instead of an empty module, section, title or summary, or a page that isn't known. */
  none?: string
}

/**
 * GVP requirement passages as a table (ID, Module, Section, Title, Page, Summary) in the admin tables'
 * framed style, with stacked cards on small screens. Used by a GVP version's Requirements and by the
 * compliance report's Requirements.
 * - `layout`: 'md' (the admin pages: the table from md) or 'report' (the table from sm and when printed,
 *   the cards below sm);
 * - `extraColumn`: one more column at the end (e.g. the report's Findings), also shown on each card,
 *   after its `cardLabel`.
 */
export function RequirementsTable({
  requirements,
  labels,
  layout = 'md',
  extraColumn,
  className = '',
}: {
  requirements: Requirement[]
  labels: RequirementsTableLabels
  layout?: 'md' | 'report'
  extraColumn?: { header: string; cardLabel: string; cell: (requirement: Requirement) => ReactNode }
  className?: string
}) {
  const columns = labels.columns
  const known = (page: number) => Number.isInteger(page) && page > 0
  const page = (requirement: Requirement) =>
    labels.none !== undefined && !known(requirement.page) ? labels.none : labels.page.replace('{page}', String(requirement.page))
  const value = (text: string) => (labels.none !== undefined && !text.trim() ? labels.none : text)
  const report = layout === 'report'
  return (
    <div className={`${className} ${tableStyles.frame}`.trim()}>
      {/* The table (scrolls inside its frame if ever too wide) */}
      <div className={report ? `${tableStyles.wideFromSm} ${tableStyles.wideScroll}` : `${tableStyles.wide} overflow-x-auto`}>
        <table aria-label={labels.tableLabel} className={tableStyles.table}>
          <thead className={tableStyles.head}>
            <tr className={report ? tableStyles.printHeadRow : undefined}>
              <th scope="col" className={tableStyles.headCell}>{columns.id}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.module}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.section}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.title}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.page}</th>
              <th scope="col" className={tableStyles.headCell}>{columns.summary}</th>
              {extraColumn && <th scope="col" className={tableStyles.headCell}>{extraColumn.header}</th>}
            </tr>
          </thead>
          <tbody className={`${tableStyles.body} align-top`}>
            {requirements.map((requirement) => (
              <tr key={requirement.id} className={report ? tableStyles.printRow : undefined}>
                <th scope="row" className={tableStyles.rowHeader}>{requirement.id}</th>
                <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{value(requirement.module)}</td>
                <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{value(requirement.section)}</td>
                <td className={`${tableStyles.cell} font-medium text-maroon`}>{value(requirement.sectionTitle)}</td>
                <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{page(requirement)}</td>
                <td className={`${tableStyles.cell} text-text-gray`}>{value(requirement.summary)}</td>
                {extraColumn && <td className={`${tableStyles.cell} whitespace-nowrap`}>{extraColumn.cell(requirement)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards */}
      <ul aria-label={labels.tableLabel} className={layout === 'md' ? tableStyles.cards : tableStyles.cardsBelowSm}>
        {requirements.map((requirement) => (
          <li key={requirement.id} className="p-4">
            <p className="text-sm font-semibold text-maroon">
              {requirement.id} · {value(requirement.sectionTitle)}
            </p>
            <p className="mt-0.5 text-sm text-text-gray">
              {value(requirement.module)} · {value(requirement.section)} · {page(requirement)}
            </p>
            <p className="mt-1.5 text-sm text-maroon">{value(requirement.summary)}</p>
            {extraColumn && (
              <p className="mt-1.5 text-sm text-text-gray">
                {extraColumn.cardLabel} {extraColumn.cell(requirement)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
