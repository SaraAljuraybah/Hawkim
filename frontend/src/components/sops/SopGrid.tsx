import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { SopsContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { sopPath } from '../../lib/routes'
import type { SopAccess } from '../../lib/sopAccess'
import { SopAccessIndicator } from './SopAccessIndicator'

interface SopGridProps {
  sops: Sop[]
  content: SopsContent
  getAccess: (sop: Sop) => SopAccess
}

/**
 * Grid of SOP cards: 1 column on phones, 2 from md, 3 from xl.
 * Cards the user can open are a single link (stretched over the whole card);
 * other cards show their access state instead and are not clickable.
 */
export function SopGrid({ sops, content, getAccess }: SopGridProps) {
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {sops.map((sop) => {
        const access = getAccess(sop)
        const granted = access === 'granted'
        return (
          <li key={sop.id}>
            <article
              className={`relative flex h-full flex-col rounded-xl border border-beige bg-white p-5 sm:p-6 ${
                granted
                  ? 'transition-colors hover:border-maroon/30 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'
                  : ''
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex size-11 items-center justify-center rounded-lg ${
                  granted ? 'bg-maroon/[0.07] text-maroon' : 'bg-beige text-text-gray'
                }`}
              >
                <FileText className="size-5" strokeWidth={1.75} />
              </span>

              <p className="mt-4 text-sm font-semibold text-maroon">{sop.code}</p>
              <h2 className="mt-1 text-base leading-snug font-medium">
                {granted ? (
                  // The ::after overlay makes the whole card clickable with one link.
                  <Link
                    to={sopPath(sop.id)}
                    aria-label={`${sop.code} ${sop.title}`}
                    className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
                  >
                    {sop.title}
                  </Link>
                ) : (
                  sop.title
                )}
              </h2>
              <p className="mt-1 mb-5 text-sm text-text-gray">{getDepartmentName(sop.departmentId)}</p>

              <div className="mt-auto border-t border-beige pt-4">
                <SopAccessIndicator sop={sop} access={access} labels={content.access} className="mb-3" />
                <div className="flex items-center justify-between gap-3 text-sm text-text-gray">
                  <span>{content.versionTemplate.replace('{version}', sop.version)}</span>
                  <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
                </div>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
