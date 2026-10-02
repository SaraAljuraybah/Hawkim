import { Link } from 'react-router-dom'
import type { SopsContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { sopPath } from '../../lib/routes'
import type { SopAccess } from '../../lib/sopAccess'
import { SopAccessIndicator } from './SopAccessIndicator'

interface SopListProps {
  sops: Sop[]
  content: SopsContent
  getAccess: (sop: Sop) => SopAccess
}

/* One link per row, stretched over the whole row with ::after. */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
/* Visible focus for the row/block that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * List view of SOPs.
 * From md up: a table with columns. Below md: compact stacked blocks, so the
 * page never scrolls sideways. Only one of the two is ever displayed.
 * Rows the user can open are links; others show their access state.
 */
export function SopList({ sops, content, getAccess }: SopListProps) {
  const { columns } = content

  return (
    <div className="overflow-hidden rounded-xl border border-beige bg-white">
      {/* Table — md and up. If it is ever wider than the space, it scrolls inside
          its own box instead of being cut off (the page itself never scrolls sideways). */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-beige/60 text-maroon">
            <tr>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold">{columns.code}</th>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold">{columns.title}</th>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold">{columns.department}</th>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold">{columns.version}</th>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold whitespace-nowrap">{columns.lastUpdated}</th>
              <th scope="col" className="px-2.5 py-3 first:pl-4 last:pr-4 font-semibold">{columns.access}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-beige">
            {sops.map((sop) => {
              const access = getAccess(sop)
              const granted = access === 'granted'
              return (
                <tr
                  key={sop.id}
                  className={granted ? `relative transition-colors hover:bg-beige/40 ${focusRing}` : ''}
                >
                  <th scope="row" className="px-2.5 py-4 first:pl-4 last:pr-4 font-semibold whitespace-nowrap text-maroon">
                    {sop.code}
                  </th>
                  <td className="px-2.5 py-4 first:pl-4 last:pr-4 font-medium text-maroon">
                    {granted ? (
                      <Link to={sopPath(sop.id)} aria-label={`${sop.code} ${sop.title}`} className={stretchedLink}>
                        {sop.title}
                      </Link>
                    ) : (
                      sop.title
                    )}
                  </td>
                  <td className="px-2.5 py-4 first:pl-4 last:pr-4 text-text-gray">{getDepartmentName(sop.departmentId)}</td>
                  <td className="px-2.5 py-4 first:pl-4 last:pr-4 text-text-gray">{sop.version}</td>
                  <td className="px-2.5 py-4 first:pl-4 last:pr-4 whitespace-nowrap text-text-gray">
                    <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
                  </td>
                  <td className="px-2.5 py-4 first:pl-4 last:pr-4">
                    {/* Stacked (label above button) to keep the column narrow */}
                    <SopAccessIndicator sop={sop} access={access} labels={content.access} stacked />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Stacked blocks — below md */}
      <ul className="divide-y divide-beige md:hidden">
        {sops.map((sop) => {
          const access = getAccess(sop)
          const granted = access === 'granted'
          return (
            <li key={sop.id} className={`p-4 ${granted ? `relative ${focusRing}` : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-maroon">{sop.code}</p>
                <time dateTime={sop.lastUpdated} className="shrink-0 text-xs text-text-gray">
                  {formatDate(sop.lastUpdated)}
                </time>
              </div>
              <p className="mt-1 text-sm leading-snug font-medium text-maroon">
                {granted ? (
                  <Link to={sopPath(sop.id)} aria-label={`${sop.code} ${sop.title}`} className={stretchedLink}>
                    {sop.title}
                  </Link>
                ) : (
                  sop.title
                )}
              </p>
              <p className="mt-1 text-xs text-text-gray">
                {getDepartmentName(sop.departmentId)}
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                {content.versionTemplate.replace('{version}', sop.version)}
              </p>
              <SopAccessIndicator sop={sop} access={access} labels={content.access} className="mt-3" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
