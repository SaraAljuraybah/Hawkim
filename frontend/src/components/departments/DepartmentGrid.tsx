import { CircleCheck, Clock, UserCheck, Users } from 'lucide-react'
import type { DepartmentsContent } from '../../content/types'
import type { Department, DepartmentId } from '../../data/mock/types'
import type { DepartmentState } from '../../lib/departments'
import { requestDepartmentAccessPath } from '../../lib/routes'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'

interface DepartmentGridProps {
  departments: Department[]
  content: DepartmentsContent
  getState: (department: Department) => DepartmentState
  /** Members: active users whose home department it is. */
  getMemberCount: (department: Department) => number
  /** Switch to a department the user belongs to. */
  onOpen: (id: DepartmentId) => void
}

/* Initials circles alternate between the two brand tints (maroon text on both). */
const tints = ['bg-maroon/[0.07] text-maroon', 'bg-gold/20 text-maroon']

const pluralRules = new Intl.PluralRules('en')

/** "{count} member" / "{count} members", chosen by plural form. */
function formatMemberCount(count: number, wording: DepartmentsContent['memberCount']) {
  const template = pluralRules.select(count) === 'one' ? wording.one : wording.other
  return template.replace('{count}', String(count))
}

const stateLabel = 'inline-flex items-center gap-1.5 text-sm font-medium text-maroon'

/**
 * Grid of department cards: 1 column on phones, 2 from md, 3 from xl.
 * Cards are not clickable; each shows the user's state (icon + text) and,
 * where relevant, one action button.
 */
export function DepartmentGrid({ departments, content, getState, getMemberCount, onOpen }: DepartmentGridProps) {
  const { states } = content

  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {departments.map((department, index) => {
        const state = getState(department)
        const nameId = `department-${department.id}-name`
        return (
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
                <h2 id={nameId} className="text-base leading-snug font-semibold">
                  {department.name}
                </h2>
                <p className="mt-1 mb-4 text-sm leading-relaxed text-text-gray">{department.description}</p>
                <p className="mt-auto inline-flex items-center gap-1.5 text-sm text-text-gray">
                  <Users aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                  {formatMemberCount(getMemberCount(department), content.memberCount)}
                </p>

                {/* The user's state for this department, and its action */}
                <div className="mt-4 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-beige pt-4">
                  {state === 'current' && (
                    <span className={stateLabel}>
                      <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                      {states.current}
                    </span>
                  )}

                  {state === 'member' && (
                    <>
                      <span className={stateLabel}>
                        <UserCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                        {states.member}
                      </span>
                      <Button size="sm" variant="secondary" aria-describedby={nameId} onClick={() => onOpen(department.id)}>
                        {states.open}
                      </Button>
                    </>
                  )}

                  {state === 'requested' && (
                    <span className="inline-flex flex-wrap items-center gap-2 text-sm text-text-gray">
                      <Clock aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                      {states.accessRequested}
                      <StatusBadge status="pending" />
                    </span>
                  )}

                  {state === 'none' && (
                    <Button
                      to={requestDepartmentAccessPath(department.id)}
                      size="sm"
                      variant="secondary"
                      aria-describedby={nameId}
                    >
                      {states.requestAccess}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
