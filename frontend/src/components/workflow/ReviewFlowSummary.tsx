import { reviewFlowEn as text } from '../../content/reviewFlow.en'
import type { Sop } from '../../data/mock/types'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'

/** Read-only plan shared by the author and reviewer workflow pages. */
export function ReviewFlowSummary({ sop }: { sop: Sop }) {
  const { nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const flow = sop.reviewFlow
  if (!flow) return null
  return <div className="mt-4 space-y-2 border-t border-beige pt-4 text-sm text-maroon">
    <p><span className="font-semibold">{text.stage}: </span>{text.stages[flow.stage]}</p>
    {!flow.reviewer2Id && <p className="text-text-gray">{text.initialPending}</p>}
    {flow.departments.length > 0 && <div>
      <p className="font-semibold">{text.plan}</p>
      <ul className="mt-2 space-y-2">{flow.departments.map((d) => <li key={d.departmentId}>
        {departmentName(d.departmentId)}: {nameOf(d.representativeId)}
        {d.reviewerId && <span> / {nameOf(d.reviewerId)}</span>}
        <span className="ml-2 text-xs text-text-gray">{d.completed ? text.completed : text.pending}</span>
      </li>)}</ul>
    </div>}
  </div>
}
