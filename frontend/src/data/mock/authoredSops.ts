import type { AuthoredSop } from './types'

/*
 * Sample SOPs authored by the current user (Sara), at different lifecycle stages.
 * These seed the in-memory authored SOPs store (src/state/), so uploads appear immediately.
 *
 * TODO (step 2): SOP-078 also exists in sops.ts (the published directory). Merge the
 * directory SOPs and authored SOPs into one SOP list so each SOP exists once.
 * TODO: Replace with data from the backend API.
 */
export const mockAuthoredSops: AuthoredSop[] = [
  {
    id: 'sop-078', // same id as the directory entry, so the published row opens /sops/sop-078
    code: 'SOP-078',
    title: 'Data Integrity Guidelines',
    departmentId: 'information-technology',
    version: '1.2',
    status: 'published',
    authorId: 'user-sara',
    lastUpdated: '2023-11-18',
    fileName: 'SOP-078.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-079',
    code: 'SOP-079',
    title: 'User Access Management',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'draft',
    authorId: 'user-sara',
    lastUpdated: '2026-09-29',
    fileName: 'SOP-079.docx',
    fileType: 'docx',
  },
  {
    id: 'sop-080',
    code: 'SOP-080',
    title: 'Backup and Restore Procedure',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'in-review',
    authorId: 'user-sara',
    lastUpdated: '2026-09-24',
    fileName: 'SOP-080.docx',
    fileType: 'docx',
  },
  {
    id: 'sop-081',
    code: 'SOP-081',
    title: 'IT Change Request Handling',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'returned',
    authorId: 'user-sara',
    lastUpdated: '2026-09-20',
    fileName: 'SOP-081.pdf',
    fileType: 'pdf',
  },
  {
    id: 'sop-082',
    code: 'SOP-082',
    title: 'System Validation Procedure',
    departmentId: 'information-technology',
    version: '1.0',
    status: 'in-approval',
    authorId: 'user-sara',
    lastUpdated: '2026-09-15',
    fileName: 'SOP-082.docx',
    fileType: 'docx',
  },
]
