import { organizationAdminEn as text } from '../content/organizationAdmin.en'

/**
 * A save refused because another active division or department of the organization already has this name
 * (save_division / save_department, errcode 23505). Shown under the Name field, not as a form error.
 * Kept apart from services/organizationAdmin so the dialogs can tell it apart even where that module is mocked.
 */
export class DuplicateNameError extends Error {
  readonly entity: 'division' | 'department'
  constructor(entity: 'division' | 'department') {
    super(entity === 'division' ? text.duplicateDivisionName : text.duplicateDepartmentName)
    this.name = 'DuplicateNameError'
    this.entity = entity
  }
}

/** The same name as saved and compared by the database: trimmed, ignoring case. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
