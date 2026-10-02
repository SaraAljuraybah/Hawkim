/*
 * Types for the sample data in src/data/mock/.
 * These describe the data the backend API will return later, so the
 * mock files can be swapped for API calls without changing components.
 */

/** The signed-in user. */
export interface User {
  name: string
  initials: string
  department: string
}
