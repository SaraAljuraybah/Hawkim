import type { PersonOption } from '../components/ui/PeoplePicker'
import { getDepartmentName } from '../data/mock/departments'
import type { User } from '../data/mock/types'

/** A user as a people-picker option: their name, with their department under it (and searchable). */
export function personOption(user: User): PersonOption {
  return { id: user.id, name: user.name, description: getDepartmentName(user.departmentId) }
}
