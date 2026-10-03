import type { User } from './types'

/*
 * Sample users. Every user is an employee; permissions add features on top.
 * TODO: Replace with data from the backend API.
 */
export const users: User[] = [
  {
    id: 'user-sara',
    name: 'Sara Aljuraybah',
    initials: 'SA',
    departmentId: 'information-technology',
    // Every user is an employee; Sara also has the Author permission.
    permissions: ['author'],
  },
  {
    id: 'user-noura',
    name: 'Noura Alqahtani',
    initials: 'NA',
    departmentId: 'information-technology',
    permissions: ['reviewer'],
  },
  {
    id: 'user-faisal',
    name: 'Faisal Alharbi',
    initials: 'FA',
    departmentId: 'quality-assurance',
    permissions: ['reviewer'],
  },
  {
    id: 'user-huda',
    name: 'Huda Alotaibi',
    initials: 'HA',
    departmentId: 'information-technology',
    permissions: ['approver'],
  },
  {
    id: 'user-khalid',
    name: 'Khalid Alzahrani',
    initials: 'KA',
    departmentId: 'quality-assurance',
    permissions: ['approver'],
  },
]

/** A user by id (undefined if unknown). */
export function getUser(id: string | undefined): User | undefined {
  return users.find((user) => user.id === id)
}
