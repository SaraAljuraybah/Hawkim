import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { GuidelineVersion } from '../../data/mock/types'
import { formatCount } from '../../lib/count'
import { formatDate } from '../../lib/format'
import { riyadhDate } from '../../lib/riyadhWorkingDays'
import { useUsers } from '../../state/usersContext'
import { IconButton } from '../ui/IconButton'
import { SourceLink } from './SourceLink'

const text = adminEn.regulations
const fileText = adminEn.regulationDetails.file

/** On a version's own page: the requirements count opens the Requirements section, and the file can be opened. */
export interface GuidelineVersionActions {
  requirements?: { expanded: boolean; controlsId: string; onToggle: () => void }
  file?: { onPreview: () => void }
}

/** A date as shown ('—' when unknown). */
function dateCell(isoDate: string | undefined): ReactNode {
  return isoDate ? <time dateTime={isoDate}>{formatDate(isoDate)}</time> : text.none
}

/** Looks like a link: maroon text, underlined on hover, with the visible focus ring. */
const linkButton = 'inline-flex items-center gap-1 rounded-sm text-left font-medium text-maroon underline-offset-2 hover:underline'

/** The file: preview and download when this browser has it, otherwise its name and why it can't be opened. */
function fileCell(version: GuidelineVersion, actions: GuidelineVersionActions): ReactNode {
  const name = <span className="break-all">{version.fileName}</span>
  if (!actions.file) return name
  if (!version.fileUrl) {
    return (
      <>
        {name}
        <span className="mt-0.5 block text-sm font-normal text-text-gray">{fileText.unavailable}</span>
      </>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" aria-label={fileText.preview.replace('{fileName}', version.fileName)} onClick={actions.file.onPreview} className={linkButton}>
        {name}
      </button>
      <IconButton label={fileText.download.replace('{fileName}', version.fileName)} icon={Download} href={version.fileUrl} download={version.fileName} />
    </span>
  )
}

/** The requirements count; on a version's own page, a disclosure for the Requirements section. */
function requirementsCell(version: GuidelineVersion, actions: GuidelineVersionActions): ReactNode {
  const count = formatCount(version.requirements.length, text.requirementsCount)
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
 * A GVP version's values, in the order of GuidelineVersionFields: title, version, issued by SFDA,
 * added to Hawkim (the Riyadh date it was added) and by whom, source, file and requirements.
 * Shared by the details list and the version history table.
 */
export function useGuidelineVersionValues(actions: GuidelineVersionActions = {}) {
  const { nameOf } = useUsers()
  return (version: GuidelineVersion): { label: string; value: ReactNode }[] => [
    { label: text.fields.title, value: version.title || text.none },
    { label: text.fields.version, value: version.version },
    { label: text.fields.issued, value: dateCell(version.issuedDate) },
    { label: text.fields.added, value: dateCell(version.addedAt ? riyadhDate(new Date(version.addedAt)) : undefined) },
    { label: text.fields.addedBy, value: (version.addedById && nameOf(version.addedById)) || text.none },
    { label: text.fields.source, value: <SourceLink source={version.source} /> },
    { label: text.fields.file, value: fileCell(version, actions) },
    { label: text.fields.requirements, value: requirementsCell(version, actions) },
  ]
}
