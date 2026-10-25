/*
 * The remembered active department (see ActiveDepartmentProvider). Storage can be
 * unavailable (private mode, blocked), so every access is optional.
 */

const STORAGE_KEY = 'hawkim.activeDepartment'

export function readStoredActiveDepartment(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // storage unavailable: fall back to the home department
  }
}

export function storeActiveDepartment(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Remembering the department is optional; ignore storage errors.
  }
}

export function clearStoredActiveDepartment(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing was stored.
  }
}
