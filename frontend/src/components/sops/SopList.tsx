import { Link } from 'react-router-dom'
import type { SopsContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { sopPath } from '../../lib/routes'

interface SopListProps {
  sops: Sop[]
  content: SopsContent
}

/* One link per row, stretched over the whole row with ::after. */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
/* Visible focus for the row/block that contains a focused link. */
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * List view of SOPs; every row links to the SOP detail page.
 * From md up: a table with columns. Below md: compact stacked blocks, so the
 * page never scrolls sideways. Only one of the two is ever displayed.
 */
export function SopList({ sops, content }: SopListProps) {
  const { columns } = content

  return (
    <div className="overflow-hidden rounded-xl border border-beige bg-white">
      {/* Table — md and up. If it is ever wider than the space, it scrolls inside
          its own box instead of being cut off (the page itself never scrolls sideways). */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-beige/60 text-maroon">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">{columns.code}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{columns.title}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{columns.department}</th>
              <th scope="col" className="px-5 py-3 font-semibold">{columns.version}</th>
              <th scope="col" className="px-5 py-3 font-semibold whitespace-nowrap">{columns.lastUpdated}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-beige">
            {sops.map((sop) => (
              <tr key={sop.id} className={`relative transition-colors hover:bg-beige/40 ${focusRing}`}>
                <th scope="row" className="px-5 py-4 font-semibold whitespace-nowrap text-maroon">
                  {sop.code}
                </th>
                <td className="px-5 py-4 font-medium text-maroon">
                  <Link to={sopPath(sop.id)} aria-label={`${sop.code} ${sop.title}`} className={stretchedLink}>
                    {sop.title}
                  </Link>
                </td>
                <td className="px-5 py-4 text-text-gray">{getDepartmentName(sop.departmentId)}</td>
                <td className="px-5 py-4 text-text-gray">{sop.version}</td>
                <td className="px-5 py-4 whitespace-nowrap text-text-gray">
                  <time dateTime={sop.lastUpdated}>{formatDate(sop.lastUpdated)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked blocks — below md */}
      <ul className="divide-y divide-beige md:hidden">
        {sops.map((sop) => (
          <li key={sop.id} className={`relative p-4 ${focusRing}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-maroon">{sop.code}</p>
              <time dateTime={sop.lastUpdated} className="shrink-0 text-xs text-text-gray">
                {formatDate(sop.lastUpdated)}
              </time>
            </div>
            <p className="mt-1 text-sm leading-snug font-medium text-maroon">
              <Link to={sopPath(sop.id)} aria-label={`${sop.code} ${sop.title}`} className={stretchedLink}>
                {sop.title}
              </Link>
            </p>
            <p className="mt-1 text-xs text-text-gray">
              {getDepartmentName(sop.departmentId)}
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {content.versionTemplate.replace('{version}', sop.version)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
