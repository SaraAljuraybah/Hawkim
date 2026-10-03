import type { DepartmentId, RequestType } from '../data/mock/types'

/** Path of an SOP's detail page in the SOPs directory. */
export function sopPath(sopId: string): string {
  return `/sops/${encodeURIComponent(sopId)}`
}

/** Path of an SOP's workflow page (the author's view). */
export function mySopPath(sopId: string): string {
  return `/my-sops/${encodeURIComponent(sopId)}`
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
