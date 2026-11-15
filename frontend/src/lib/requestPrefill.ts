import { requestsEn } from '../content/requests.en'
import type { DepartmentId, RequestType, Sop } from '../data/mock/types'
import { REQUEST_PREFILL_PARAMS } from './routes'

/** What Submit a Request's form holds. */
export type RequestFormValues = { type: RequestType | ''; departmentId: DepartmentId | ''; title: string; description: string }

export const emptyRequestValues: RequestFormValues = { type: '', departmentId: '', title: '', description: '' }

/**
 * Initial values from the URL, e.g. ?type=department-access&department=quality-assurance
 * (used by "Request access" on locked SOPs), or ?type=regulatory-guideline-addition&sop=<id> (Check Compliance
 * while the organization has no regulatory guideline: a title and description to start from, naming the SOP when
 * it is one of the user's). Unknown values are ignored, and the department is only kept for Department Access
 * and when it is not the user's own. Nothing is sent until the user submits.
 */
export function prefillFromParams(
  params: URLSearchParams,
  typeOptions: RequestType[],
  departmentOptions: DepartmentId[],
  fromSop?: Pick<Sop, 'title'>,
): RequestFormValues {
  const type = params.get(REQUEST_PREFILL_PARAMS.type) as RequestType | null
  const department = params.get(REQUEST_PREFILL_PARAMS.department) as DepartmentId | null
  const validType = type && typeOptions.includes(type) ? type : ''
  const validDepartment =
    validType === 'department-access' && department && departmentOptions.includes(department) ? department : ''
  if (validType === 'regulatory-guideline-addition') {
    const prefill = requestsEn.submit.guidelinePrefill
    return {
      ...emptyRequestValues,
      type: validType,
      title: prefill.title,
      description: fromSop ? prefill.descriptionForSop.replace('{title}', fromSop.title) : prefill.description,
    }
  }
  return { ...emptyRequestValues, type: validType, departmentId: validDepartment }
}

