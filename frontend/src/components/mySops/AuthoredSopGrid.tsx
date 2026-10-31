import { FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MySopsContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { recheckRecommended } from '../../lib/guidelines'
import { mySopPath } from '../../lib/routes'
import { useGuidelines } from '../../state/guidelinesContext'
import { RecheckBadge } from '../compliance/RecheckBadge'
import { StatusBadge } from '../ui/StatusBadge'

interface AuthoredSopGridProps {
  sops: Sop[]
  content: MySopsContent
  userId: string
}

/** The same ownership and lifecycle information as the list, in responsive cards. */
export function AuthoredSopGrid({ sops, content, userId }: AuthoredSopGridProps) {
  const currentGuideline = useGuidelines().current.version
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
      {sops.map((sop) => {
        const role = sop.authorId === userId ? content.mainAuthorLabel : content.coAuthorLabel
        const recheck = recheckRecommended(sop, currentGuideline)
        return (
          <li key={sop.id}>
            <article className="relative flex h-full flex-col rounded-xl border border-beige bg-white p-5 transition-colors hover:border-maroon/30 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon">
                  <FileText className="size-5" strokeWidth={1.75} />
                </span>
                <StatusBadge status={sop.status} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-medium text-maroon">{role}</span>
                {recheck && <RecheckBadge label={content.recheckLabel} className="px-2" />}
              </div>
              <h2 className="mt-2 mb-5 text-base leading-snug font-medium">
                <Link to={mySopPath(sop.id)} aria-label={`${sop.title} (${role})${recheck ? ` (${content.recheckLabel})` : ''}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
                  {sop.title}
                </Link>
              </h2>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-beige pt-4 text-sm text-text-gray">
                <span>{content.versionTemplate.replace('{version}', sop.version)}</span>
                <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
