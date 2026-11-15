/**
 * How a refusal of begin_department_file_deletion is answered. The database decides every refusal; this only
 * names it for the browser, without SQL details:
 * - 42501                          → 403 forbidden (not an active Admin);
 * - P0001, hint 'default-department' → 409 default-department: one of the organization's default departments
 *   (Pharmacovigilance, Quality Assurance), which are never deleted (20261120120000). Another organization's
 *   department is never reported as one: the database answers it as unknown (the conflict below) first;
 * - 23503                          → 409 employees-assigned (employees, or SOPs that still exist);
 * - 23514                          → 409 active-workflow (open reviews or running compliance checks);
 * - anything else                  → 409 conflict (changed or unknown department).
 */
export function beginDeletionRefusal(error: { code?: string; hint?: string }): { status: number; errorCode: string } {
  if (error.code === '42501') return { status: 403, errorCode: 'forbidden' }
  if (error.code === 'P0001' && error.hint === 'default-department') return { status: 409, errorCode: 'default-department' }
  if (error.code === '23503') return { status: 409, errorCode: 'employees-assigned' }
  if (error.code === '23514') return { status: 409, errorCode: 'active-workflow' }
  return { status: 409, errorCode: 'conflict' }
}
