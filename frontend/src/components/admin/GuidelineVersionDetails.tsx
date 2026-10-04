import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { formatCount } from '../../lib/count'
import { formatDate, formatDateTime } from '../../lib/format'
import { useUsers } from '../../state/usersContext'

/**
 * A GVP version's details: issued and effective dates (issued only when known), file,
 * who added it and when (only when known), number of requirements and the summary of changes.
 */
export function GuidelineVersionDetails({ version, className = '' }: { version: GuidelineVersion; className?: string }) {
  const text = adminEn.regulations
  const { nameOf } = useUsers()
  const items = [
    ...(version.issuedDate
      ? [{ label: text.fields.issued, value: <time dateTime={version.issuedDate}>{formatDate(version.issuedDate)}</time> }]
      : []),
    { label: text.fields.effective, value: <time dateTime={version.effectiveDate}>{formatDate(version.effectiveDate)}</time> },
    { label: text.fields.file, value: <span className="break-all">{version.fileName}</span> },
    { label: text.fields.requirements, value: formatCount(version.requirements.length, text.requirementsCount) },
    ...(version.addedById && version.addedAt
      ? [
          {
            label: text.fields.added,
            value: text.addedBy.replace('{name}', nameOf(version.addedById)).replace('{date}', formatDateTime(version.addedAt)),
          },
        ]
      : []),
    ...(version.summary ? [{ label: text.fields.summary, value: version.summary, wide: true }] : []),
  ]
  return (
    <dl className={`grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 ${'wide' in item && item.wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
          <dt className="text-text-gray">{item.label}</dt>
          <dd className="mt-0.5 font-medium whitespace-pre-line text-maroon">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
