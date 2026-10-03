import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { MySopsContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { mySopPath } from '../../lib/routes'
import { StatusBadge } from '../ui/StatusBadge'

interface AuthoredSopListProps {
  sops: Sop[]
  content: MySopsContent
  /** The signed-in user; SOPs they co-author get a "Co-author" label. */
  userId: string
}

/* Visible focus for the row that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * The user's SOPs: icon, code (plus "Co-author" if they aren't the main author),
 * title, status, version and last updated.
 * Every row links to its SOP workflow page (one link stretched over the row).
 * Rows stack on phones; from sm the details line up in columns.
 */
export function AuthoredSopList({ sops, content, userId }: AuthoredSopListProps) {
  return (
    <ul className="divide-y divide-beige rounded-xl border border-beige bg-white">
      {sops.map((sop) => {
        const coAuthored = sop.authorId !== userId
        return (
          <li
            key={sop.id}
            className={`relative flex flex-col gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-beige/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5 ${focusRing}`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"
              >
                <FileText className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-maroon">
                  {sop.code}
                  {coAuthored && (
                    <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-medium text-maroon">{content.coAuthorLabel}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[0.9375rem] leading-snug font-medium text-maroon">
                  <Link
                    to={mySopPath(sop.id)}
                    aria-label={`${sop.code} ${sop.title}${coAuthored ? ` (${content.coAuthorLabel})` : ''}`}
                    className="after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {sop.title}
                  </Link>
                </p>
              </div>
            </div>

            {/* Status, version and date: wrap under the title on phones, aligned columns from sm */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-[3.25rem] sm:grid sm:grid-cols-[7rem_5.5rem_6.5rem] sm:gap-4 sm:pl-0">
              <div>
                <StatusBadge status={sop.status} />
              </div>
              <span className="text-sm whitespace-nowrap text-text-gray">
                {content.versionTemplate.replace('{version}', sop.version)}
              </span>
              <time dateTime={sop.lastUpdated} className="text-sm whitespace-nowrap text-text-gray">
                {formatDate(sop.lastUpdated)}
              </time>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
