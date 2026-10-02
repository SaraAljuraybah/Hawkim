import type { Sop } from './types'

/*
 * Sample SOPs (from the approved design). All are approved for now.
 * TODO: Replace with data from the backend API.
 */
export const sops: Sop[] = [
  {
    id: 'sop-017',
    code: 'SOP-017',
    title: 'Pharmaceutical Quality Control Process',
    departmentId: 'quality-assurance',
    version: '2.1',
    lastUpdated: '2024-01-12',
    status: 'approved',
  },
  {
    id: 'sop-032',
    code: 'SOP-032',
    title: 'Adverse Drug Reaction Reporting',
    departmentId: 'pharmacovigilance',
    version: '1.4',
    lastUpdated: '2024-01-05',
    status: 'approved',
  },
  {
    id: 'sop-045',
    code: 'SOP-045',
    title: 'Supplier Qualification Procedure',
    departmentId: 'quality-assurance',
    version: '1.0',
    lastUpdated: '2023-12-20',
    status: 'approved',
  },
  {
    id: 'sop-061',
    code: 'SOP-061',
    title: 'Change Control Management',
    departmentId: 'regulatory-affairs',
    version: '1.3',
    lastUpdated: '2023-12-01',
    status: 'approved',
  },
  {
    id: 'sop-078',
    code: 'SOP-078',
    title: 'Data Integrity Guidelines',
    departmentId: 'information-technology',
    version: '1.2',
    lastUpdated: '2023-11-18',
    status: 'approved',
  },
  {
    id: 'sop-093',
    code: 'SOP-093',
    title: 'Risk Management Procedure',
    departmentId: 'quality-assurance',
    version: '1.0',
    lastUpdated: '2024-01-20',
    status: 'approved',
  },
]
