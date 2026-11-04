export const organizationEn = {
  title: 'Organizational Structure',
  organization: 'Organization',
  retry: 'Retry',
  loading: 'Loading organizational structure…',
  error: 'The organizational structure could not be loaded. Please try again.',
  empty: 'No departments have been configured yet.',
  noEmployees: 'No employees assigned',
  noDivisions: 'Departments are shown directly under the organization until divisions are configured.',
  directDepartments: 'Departments without a division',
  permissionsLabel: 'Permissions',
  positionLabel: 'Position',
  employees: (count: number) => `${count} ${count === 1 ? 'employee' : 'employees'}`,
}
