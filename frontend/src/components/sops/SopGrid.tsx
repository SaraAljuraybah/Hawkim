import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { SopsContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { sopPath } from '../../lib/routes'

interface SopGridProps {
  sops: Sop[]
  content: SopsContent
}

/**
 * Grid of SOP cards: 1 column on phones, 2 from md, 3 from xl.
 * Each card is a single link (stretched over the whole card) to the SOP detail page.
 */
export function SopGrid({ sops, content }: SopGridProps) {
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {sops.map((sop) => (
        <li key={sop.id}>
          <article className="relative flex h-full flex-col rounded-xl border border-beige bg-white p-5 transition-colors hover:border-maroon/30 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid sm:p-6">
            <span
              aria-hidden="true"
              className="inline-flex size-11 items-center justify-center rounded-lg bg-maroon/[0.07] text-maroon"
            >
              <FileText className="size-5" strokeWidth={1.75} />
            </span>

            <p className="mt-4 text-sm font-semibold text-maroon">{sop.code}</p>
            <h2 className="mt-1 text-base leading-snug font-medium">
              {/* The ::after overlay makes the whole card clickable with one link. */}
              <Link
                to={sopPath(sop.id)}
                aria-label={`${sop.code} ${sop.title}`}
                className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
              >
                {sop.title}
              </Link>
            </h2>
            <p className="mt-1 mb-5 text-sm text-text-gray">{getDepartmentName(sop.departmentId)}</p>

            <div className="mt-auto flex items-center justify-between gap-3 border-t border-beige pt-4 text-sm text-text-gray">
              <span>{content.versionTemplate.replace('{version}', sop.version)}</span>
              <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
            </div>
          </article>
        </li>
      ))}
    </ul>
  )
}
