import type { ReactNode } from 'react'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { formatCount } from '../../lib/count'
import { formatDate } from '../../lib/format'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { useUsers } from '../../state/usersContext'
import { SourceLink } from './SourceLink'

const text = adminEn.regulations

/** A date as shown ('—' when unknown). */
function dateCell(isoDate: string | undefined): ReactNode {
  return isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : text.none
}

/**
 * A GVP version's values, in the order of GuidelineVersionFields: title, version, issued by SFDA,
 * added to Hawkim (the Riyadh date it was added) and by whom, source, file and requirements.
 * Shared by the details list and the version history table.
 */
export function useGuidelineVersionValues() {
  const { nameOf } = useUsers()
  return (version: GuidelineVersion): { label: string; value: ReactNode }[] => [
    { label: text.fields.title, value: version.title || text.none },
    { label: text.fields.version, value: version.version },
    { label: text.fields.issued, value: dateCell(version.issuedDate) },
    { label: text.fields.added, value: dateCell(version.addedAt ? riyadhDate(new Date(version.addedAt)) : undefined) },
    { label: text.fields.addedBy, value: (version.addedById && nameOf(version.addedById)) || text.none },
    { label: text.fields.source, value: <SourceLink source={version.source} /> },
    { label: text.fields.file, value: <span className="break-all">{version.fileName}</span> },
    { label: text.fields.requirements, value: formatCount(version.requirements.length, text.requirementsCount) },
  ]
}
