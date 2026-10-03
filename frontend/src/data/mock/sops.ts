import type { Sop } from './types'

/*
 * Sample SOPs (from the approved design). All are approved for now.
 * Each points to a placeholder PDF in public/sample-sops/ (see scripts/generate-sample-sops.mjs).
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
    fileUrl: '/sample-sops/SOP-017.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-032',
    code: 'SOP-032',
    title: 'Adverse Drug Reaction Reporting',
    departmentId: 'pharmacovigilance',
    version: '1.4',
    lastUpdated: '2024-01-05',
    status: 'approved',
    fileUrl: '/sample-sops/SOP-032.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-045',
    code: 'SOP-045',
    title: 'Supplier Qualification Procedure',
    departmentId: 'quality-assurance',
    version: '1.0',
    lastUpdated: '2023-12-20',
    status: 'approved',
    fileUrl: '/sample-sops/SOP-045.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-061',
    code: 'SOP-061',
    title: 'Change Control Management',
    departmentId: 'regulatory-affairs',
    version: '1.3',
    lastUpdated: '2023-12-01',
    status: 'approved',
    fileUrl: '/sample-sops/SOP-061.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-078',
    code: 'SOP-078',
    title: 'Data Integrity Guidelines',
    departmentId: 'information-technology',
    version: '1.2',
    lastUpdated: '2023-11-18',
    status: 'approved',
    fileUrl: '/sample-sops/SOP-078.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-093',
    code: 'SOP-093',
    title: 'Risk Management Procedure',
    departmentId: 'quality-assurance',
    version: '1.0',
    lastUpdated: '2024-01-20',
    status: 'approved',
    fileUrl: '/sample-sops/SOP-093.pdf',
    fileType: 'pdf',
  },
]
