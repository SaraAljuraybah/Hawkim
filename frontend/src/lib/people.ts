import type { PersonOption } from '../components/ui/PeoplePicker'
import type { User } from '../data/mock/types'

/**
 * A user as a people-picker option: their name, with their department under it (and
 * searchable). `departmentName` comes from the departments store.
 */
export function personOption(user: User, departmentName: (id: string) => string): PersonOption {
  return { id: user.id, name: user.name, description: departmentName(user.departmentId) }
}
