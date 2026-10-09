import type { DepartmentId, RequestType } from '../data/mock/types'

/** Path of an SOP's detail page in the SOPs directory. */
export function sopPath(sopId: string): string {
  return `/sops/${encodeURIComponent(sopId)}`
}

/** Path of an SOP's workflow page (the author's view). */
export function mySopPath(sopId: string): string {
  return `/my-sops/${encodeURIComponent(sopId)}`
}

/** Path of an SOP's review page (its reviewers' and approvers' view). */
export function reviewPath(sopId: string): string {
  return `/reviews/${encodeURIComponent(sopId)}`
}

/** Path of an SOP's compliance report for its reviewers and approvers (read-only). */
export function reviewCompliancePath(sopId: string): string {
  return `${reviewPath(sopId)}/compliance`
}

/** Path of an SOP's compliance report (the author's and co-authors' view). */
export function complianceReportPath(sopId: string): string {
  return `${mySopPath(sopId)}/compliance`
}

/** Query parameter names that Submit a Request reads to prefill the form. */
export const REQUEST_PREFILL_PARAMS = { type: 'type', department: 'department' } as const

/**
 * Link to Submit a Request with "Department Access" and the given department preselected,
 * e.g. /requests/new?type=department-access&department=quality-assurance
 */
export function requestDepartmentAccessPath(departmentId: DepartmentId): string {
  const type: RequestType = 'department-access'
  const params = new URLSearchParams({
    [REQUEST_PREFILL_PARAMS.type]: type,
    [REQUEST_PREFILL_PARAMS.department]: departmentId,
  })
  return `/requests/new?${params.toString()}`
}

/** The admin portal's home (its users list); admins opening an employee screen go here. */
export const ADMIN_USERS_PATH = '/admin/users'

/** The admin portal's departments list. */
export const ADMIN_DEPARTMENTS_PATH = '/admin/departments'

/** A department's page in the admin portal, e.g. /admin/departments/quality-assurance */
export function adminDepartmentPath(departmentId: string): string {
  return `${ADMIN_DEPARTMENTS_PATH}/${encodeURIComponent(departmentId)}`
}

/** The form to edit a department in the admin portal. */
export function adminDepartmentEditPath(departmentId: string): string {
  return `${adminDepartmentPath(departmentId)}/edit`
}

/** The admin portal's requests list. */
export const ADMIN_REQUESTS_PATH = '/admin/requests'

/** A request's page in the admin portal, e.g. /admin/requests/req-004 */
export function adminRequestPath(requestId: string): string {
  return `${ADMIN_REQUESTS_PATH}/${encodeURIComponent(requestId)}`
}

/** The admin portal's regulations page. */
export const ADMIN_REGULATIONS_PATH = '/admin/regulations'

/** A GVP version's page in the admin portal, e.g. /admin/regulations/gvp-4-0 */
export function adminRegulationPath(versionId: string): string {
  return `${ADMIN_REGULATIONS_PATH}/${encodeURIComponent(versionId)}`
}

/** A user's page in the admin portal, e.g. /admin/users/user-sara */
export function adminUserPath(userId: string): string {
  return `${ADMIN_USERS_PATH}/${encodeURIComponent(userId)}`
}
