import type { SopWorkflowContent } from '../../content/types'
import type { Sop, SopComment } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { useUsers } from '../../state/usersContext'
import { personWithRole } from './people'

interface CommentItemsProps {
  sop: Sop
  comments: SopComment[]
  content: SopWorkflowContent
}

/** One or more comments: who (with role), when, and the text. Newest first. */
export function CommentItems({ sop, comments, content }: CommentItemsProps) {
  const { nameOf } = useUsers()
  const sorted = [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <ul className="space-y-3">
      {sorted.map((comment) => (
        <li key={comment.id} className="rounded-lg border border-beige bg-white p-4">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-maroon">{personWithRole(sop, comment.authorUserId, content.roles, nameOf)}</span>
            <time dateTime={comment.createdAt} className="text-xs text-text-gray">
              {formatDateTime(comment.createdAt)}
            </time>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-maroon">{comment.text}</p>
        </li>
      ))}
    </ul>
  )
}

interface CommentListProps {
  sop: Sop
  content: SopWorkflowContent
}

/** All comments, grouped by version (newest version first), or "No comments yet." */
export function CommentList({ sop, content }: CommentListProps) {
  if (sop.comments.length === 0) return <p className="text-sm text-text-gray">{content.comments.empty}</p>

  const versions = [...new Set(sop.comments.map((comment) => comment.version))].sort((a, b) => Number(b) - Number(a))
  return (
    <div className="space-y-5">
      {versions.map((version) => (
        <div key={version}>
          <h3 className="mb-2 text-sm font-semibold text-text-gray">
            {content.comments.versionHeading.replace('{version}', version)}
          </h3>
          <CommentItems sop={sop} comments={sop.comments.filter((comment) => comment.version === version)} content={content} />
        </div>
      ))}
    </div>
  )
}
