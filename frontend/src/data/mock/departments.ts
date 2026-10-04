import type { Department } from './types'

/*
 * Sample departments (from the approved design). They seed the in-memory
 * departments store (src/state/DepartmentsProvider.tsx), which the admin portal changes.
 * TODO: Replace with data from the backend API.
 */
export const sampleDepartments: Department[] = [
  {
    id: 'quality-assurance',
    name: 'Quality Assurance',
    initials: 'QA',
    description: 'Responsible for quality oversight and compliance.',
    memberCount: 12,
  },
  {
    id: 'regulatory-affairs',
    name: 'Regulatory Affairs',
    initials: 'RA',
    description: 'Handles regulatory submissions and communications.',
    memberCount: 8,
  },
  {
    id: 'pharmacovigilance',
    name: 'Pharmacovigilance',
    initials: 'PV',
    description: 'Monitors and evaluates product safety.',
    memberCount: 6,
  },
  {
    id: 'research-development',
    name: 'Research & Development',
    initials: 'RD',
    description: 'Drives innovation and product development.',
    memberCount: 10,
  },
  {
    id: 'information-technology',
    name: 'Information Technology',
    initials: 'IT',
    description: "Supports the organization's technology infrastructure.",
    memberCount: 8,
  },
  {
    id: 'human-resources',
    name: 'Human Resources',
    initials: 'HR',
    description: 'Manages people, policies and culture.',
    memberCount: 7,
  },
  {
    id: 'finance-administration',
    name: 'Finance & Administration',
    initials: 'FA',
    description: 'Oversees financial and administrative operations.',
    memberCount: 4,
  },
  {
    id: 'clinical-operations',
    name: 'Clinical Operations',
    initials: 'CL',
    description: 'Supports clinical studies and operations.',
    memberCount: 6,
  },
  {
    id: 'legal-governance',
    name: 'Legal & Governance',
    initials: 'LG',
    description: 'Ensures legal compliance and governance.',
    memberCount: 3,
  },
]
