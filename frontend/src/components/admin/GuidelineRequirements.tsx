import { Button } from '../ui/Button'
import { tableStyles } from '../ui/tableStyles'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'

/**
 * A GVP version's Requirements section: a table from md, stacked cards below. Hidden, heading
 * included, until the requirements count in the version's details (GuidelineVersionDetails with
 * `actions.requirements`) opens it; `id` is what that count controls. Used on a version's own page
 * (an h2) and in the Current Version card (an h3).
 */
export function GuidelineRequirements({
  version,
  id,
  titleId,
  heading: Heading,
  hidden,
  className = '',
  loading,
}: {
  version: GuidelineVersion
  id: string
  titleId: string
  heading: 'h2' | 'h3'
  hidden: boolean
  className?: string
  /** A published version's passages, read on its page: still being read, or they couldn't be read. */
  loading?: { state: 'loading' | 'failed'; onRetry: () => void }
}) {
  const text = adminEn.regulationDetails.requirements
  const columns = text.columns
  if (loading) {
    return (
      <section id={id} aria-labelledby={titleId} hidden={hidden} className={className}>
        <Heading id={titleId} className={Heading === 'h2' ? 'text-lg' : 'text-base'}>
          {text.title}
        </Heading>
        {loading.state === 'loading' ? (
          <p role="status" className="mt-3 text-sm text-text-gray">{text.loading}</p>
        ) : (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-status-rejected-fg">{text.failed}</p>
            <Button variant="secondary" size="sm" onClick={loading.onRetry}>{text.retry}</Button>
          </div>
        )}
      </section>
    )
  }
  return (
    <section id={id} aria-labelledby={titleId} hidden={hidden} className={className}>
      <Heading id={titleId} className={Heading === 'h2' ? 'text-lg' : 'text-base'}>
        {text.title}
      </Heading>
      <div className={`mt-3 ${tableStyles.frame}`}>
        {/* Table — md and up, styled like the other admin tables (scrolls inside its frame if ever too wide) */}
        <div className={`${tableStyles.wide} overflow-x-auto`}>
          <table aria-label={text.tableLabel} className={tableStyles.table}>
            <thead className={tableStyles.head}>
              <tr>
                <th scope="col" className={tableStyles.headCell}>{columns.id}</th>
                <th scope="col" className={tableStyles.headCell}>{columns.module}</th>
                <th scope="col" className={tableStyles.headCell}>{columns.section}</th>
                <th scope="col" className={tableStyles.headCell}>{columns.title}</th>
                <th scope="col" className={tableStyles.headCell}>{columns.page}</th>
                <th scope="col" className={tableStyles.headCell}>{columns.summary}</th>
              </tr>
            </thead>
            <tbody className={`${tableStyles.body} align-top`}>
              {version.requirements.map((requirement) => (
                <tr key={requirement.id}>
                  <th scope="row" className={tableStyles.rowHeader}>{requirement.id}</th>
                  <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{requirement.module}</td>
                  <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{requirement.section}</td>
                  <td className={`${tableStyles.cell} font-medium text-maroon`}>{requirement.sectionTitle}</td>
                  <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>
                    {text.page.replace('{page}', String(requirement.page))}
                  </td>
                  <td className={`${tableStyles.cell} text-text-gray`}>{requirement.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Stacked cards — below md */}
        <ul aria-label={text.tableLabel} className={tableStyles.cards}>
          {version.requirements.map((requirement) => (
            <li key={requirement.id} className="p-4">
              <p className="text-sm font-semibold text-maroon">
                {requirement.id} · {requirement.sectionTitle}
              </p>
              <p className="mt-0.5 text-sm text-text-gray">
                {requirement.module} · {requirement.section} ·{' '}
                {text.page.replace('{page}', String(requirement.page))}
              </p>
              <p className="mt-1.5 text-sm text-maroon">{requirement.summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
