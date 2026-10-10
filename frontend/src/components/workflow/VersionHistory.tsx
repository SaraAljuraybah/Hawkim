import type { MouseEvent } from 'react'
import { Download, Eye, Trash2 } from 'lucide-react'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop, SopVersion } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { activeVersions } from '../../lib/workflow'
import { useUsers } from '../../state/usersContext'
import { IconButton } from '../ui/IconButton'

interface VersionHistoryProps {
  sop: Sop
  content: SopWorkflowContent
  /** The signed-in user (their uploads show as "You"). */
  userId: string
  /** Why versions can't be deleted now (undefined: they can). */
  deleteReason: string | undefined
  onPreview: (version: SopVersion, trigger: HTMLElement) => void
  onDelete: (version: SopVersion, trigger: HTMLElement) => void
}

/** Download name of a version, e.g. "SOP-078_v3.docx". */
function versionDownloadName(sop: Sop, version: SopVersion) {
  return `${sop.code}_v${version.version}.${version.fileType}`
}

/**
 * SOP history: every version that wasn't deleted, newest first, with who uploaded it
 * and when, and Preview, Download and Delete. A table from md up; stacked cards on
 * phones. Unavailable actions stay focusable and say why in their tooltip.
 */
export function VersionHistory({ sop, content, userId, deleteReason, onPreview, onDelete }: VersionHistoryProps) {
  const text = content.history
  const { nameOf } = useUsers()
  const versions = [...activeVersions(sop)].sort((a, b) => Number(b.version) - Number(a.version))

  const label = (version: SopVersion) => content.versionTemplate.replace('{version}', version.version)
  const author = (version: SopVersion) => {
    const id = version.uploadedById ?? sop.authorId
    return id === userId ? text.you : nameOf(id)
  }
  const fill = (template: string, version: SopVersion) => template.replace('{version}', version.version)

  function actions(version: SopVersion) {
    const previewReason =
      version.fileType !== 'pdf' ? text.unavailable.word : !version.fileUrl ? text.unavailable.demo : undefined
    return {
      preview: (
        <IconButton
          label={fill(text.previewLabel, version)}
          icon={Eye}
          disabledReason={previewReason}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onPreview(version, event.currentTarget)}
        />
      ),
      download: (
        <IconButton
          label={fill(text.downloadLabel, version)}
          icon={Download}
          href={version.fileUrl}
          download={versionDownloadName(sop, version)}
          disabledReason={version.fileUrl ? undefined : text.unavailable.demo}
        />
      ),
      delete: (
        <IconButton
          label={fill(text.deleteLabel, version)}
          icon={Trash2}
          danger
          disabledReason={deleteReason}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onDelete(version, event.currentTarget)}
        />
      ),
    }
  }

  const versionCell = (version: SopVersion) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-semibold text-maroon">{label(version)}</span>
      {version.version === sop.version && (
        <span className="rounded-full bg-maroon/[0.07] px-2 py-0.5 text-xs font-semibold text-maroon">{text.current}</span>
      )}
    </span>
  )
  const date = (version: SopVersion) => <time dateTime={version.uploadedAt}>{formatDateTime(version.uploadedAt)}</time>

  return (
    <>
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">{text.title}</caption>
        <thead>
          <tr className="border-b border-beige text-text-gray">
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.columns.version}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.columns.author}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {text.columns.date}
            </th>
            <th scope="col" className="w-20 py-2 text-center font-medium">
              {text.columns.preview}
            </th>
            <th scope="col" className="w-20 py-2 text-center font-medium">
              {text.columns.download}
            </th>
            <th scope="col" className="w-20 py-2 text-center font-medium">
              {text.columns.delete}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-beige">
          {versions.map((version) => {
            const buttons = actions(version)
            return (
              <tr key={version.version}>
                <th scope="row" className="py-3 pr-4 font-normal">
                  {versionCell(version)}
                </th>
                <td className="py-3 pr-4 text-maroon">{author(version)}</td>
                <td className="py-3 pr-4 text-text-gray">{date(version)}</td>
                <td className="py-3 text-center">{buttons.preview}</td>
                <td className="py-3 text-center">{buttons.download}</td>
                <td className="py-3 text-center">{buttons.delete}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Phones: one card per version */}
      <ul className="space-y-3 md:hidden">
        {versions.map((version) => {
          const buttons = actions(version)
          return (
            <li key={version.version} className="rounded-lg border border-beige p-4">
              <p>{versionCell(version)}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-text-gray">{text.columns.author}</dt>
                <dd className="min-w-0 text-maroon">{author(version)}</dd>
                <dt className="text-text-gray">{text.columns.date}</dt>
                <dd className="min-w-0 text-text-gray">{date(version)}</dd>
              </dl>
              <div className="mt-3 flex justify-end gap-2">
                {buttons.preview}
                {buttons.download}
                {buttons.delete}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
