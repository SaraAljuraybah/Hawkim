import { Users } from 'lucide-react'
import type { DepartmentsContent } from '../../content/types'
import type { Department } from '../../data/mock/types'

interface DepartmentGridProps {
  departments: Department[]
  content: DepartmentsContent
}

/* Initials circles alternate between the two brand tints (maroon text on both). */
const tints = ['bg-maroon/[0.07] text-maroon', 'bg-gold/20 text-maroon']

const pluralRules = new Intl.PluralRules('en')

/** "{count} member" / "{count} members", chosen by plural form. */
function formatMemberCount(count: number, wording: DepartmentsContent['memberCount']) {
  const template = pluralRules.select(count) === 'one' ? wording.one : wording.other
  return template.replace('{count}', String(count))
}

/** Grid of department cards: 1 column on phones, 2 from md, 3 from xl. */
export function DepartmentGrid({ departments, content }: DepartmentGridProps) {
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {departments.map((department, index) => (
        <li key={department.id}>
          {/* TODO: Make the card a link to the department detail page once it exists. */}
          <article className="flex h-full items-start gap-4 rounded-xl border border-beige bg-white p-5 sm:p-6">
            <span
              aria-hidden="true"
              className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                tints[index % tints.length]
              }`}
            >
              {department.initials}
            </span>

            <div className="flex min-w-0 flex-1 flex-col self-stretch">
              <h2 className="text-base leading-snug font-semibold">{department.name}</h2>
              <p className="mt-1 mb-4 text-sm leading-relaxed text-text-gray">{department.description}</p>
              <p className="mt-auto inline-flex items-center gap-1.5 text-sm text-text-gray">
                <Users aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                {formatMemberCount(department.memberCount, content.memberCount)}
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  )
}
