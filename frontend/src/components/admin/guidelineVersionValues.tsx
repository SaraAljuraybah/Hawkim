import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { formatCount } from '../../lib/count'
import { formatDate } from '../../lib/format'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { useUsers } from '../../state/usersContext'
import { SourceLink } from './SourceLink'

const text = adminEn.regulations

/** On a version's own page: the requirements count opens the Requirements section, and the file has its own card. */
export interface GuidelineVersionActions {
  requirements?: { expanded: boolean; controlsId: string; onToggle: () => void }
  /** Leave out the File row (shown in a card of its own). */
  withoutFile?: boolean
  /** Leave out the Requirements row (the Current Version card: the count is on the version's page). */
  withoutRequirements?: boolean
}

/** A date as shown ('—' when unknown). */
function dateCell(isoDate: string | undefined): ReactNode {
  return isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : text.none
}

/** Looks like a link: maroon text, underlined on hover, with the visible focus ring. */
const linkButton = 'inline-flex items-center gap-1 rounded-sm text-left font-medium text-maroon underline-offset-2 hover:underline'

/** The requirements count; on a version's own page, a disclosure for the Requirements section. */
function requirementsCell(version: GuidelineVersion, actions: GuidelineVersionActions): ReactNode {
  // A published version from the database knows its count; its passages are read on its page only.
  const count = formatCount(version.requirementCount ?? version.requirements.length, text.requirementsCount)
  const disclosure = actions.requirements
  if (!disclosure) return count
  const Chevron = disclosure.expanded ? ChevronUp : ChevronDown
  return (
    <button type="button" aria-expanded={disclosure.expanded} aria-controls={disclosure.controlsId} onClick={disclosure.onToggle} className={linkButton}>
      {count}
      <Chevron aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
    </button>
  )
}

/**
 * A GVP version's values, in one order wherever the version card appears (the admin's Current Version
 * card, a version's own page and the authors' GVP page): Title, Version, Source, then Issued by SFDA On,
 * Added to Hawkim On (the Riyadh date it was added) and Added By, then File and Requirements (each
 * unless left out). In the card's three columns that is one row of each three.
 */
export function useGuidelineVersionValues(actions: GuidelineVersionActions = {}) {
  const { nameOf } = useUsers()
  return (version: GuidelineVersion): { label: string; value: ReactNode }[] => [
    { label: text.fields.title, value: version.title || text.none },
    { label: text.fields.version, value: version.version },
    { label: text.fields.source, value: <SourceLink source={version.source} /> },
    { label: text.fields.issued, value: dateCell(version.issuedDate) },
    { label: text.fields.added, value: dateCell(version.addedAt ? riyadhDate(new Date(version.addedAt)) : undefined) },
    // No recorded uploader: the temporary placeholder name (a recorded one whose name is unknown stays "—").
    { label: text.fields.addedBy, value: version.addedById ? nameOf(version.addedById) || text.none : text.addedByFallback },
    ...(actions.withoutFile ? [] : [{ label: text.fields.file, value: <span className="break-all">{version.fileName}</span> }]),
    ...(actions.withoutRequirements ? [] : [{ label: text.fields.requirements, value: requirementsCell(version, actions) }]),
  ]
}
