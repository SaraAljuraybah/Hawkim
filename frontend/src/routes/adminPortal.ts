/*
 * The admin portal, loaded as ONE separate chunk (route-based code splitting): its
 * layout and every /admin page. Imported lazily from routes/guards.tsx and App.tsx.
 */
export { AdminLayout } from '../components/layout/AdminLayout'
export { AddAdminPage } from '../pages/admin/AddAdminPage'
export { AddUserPage } from '../pages/admin/AddUserPage'
export { AdminAdminsPage } from '../pages/admin/AdminAdminsPage'
export { AdminDetailsPage } from '../pages/admin/AdminDetailsPage'
export { EditAdminPage } from '../pages/admin/EditAdminPage'
export { AdminDepartmentsPage } from '../pages/admin/AdminDepartmentsPage'
export { AdminRegulationsPage } from '../pages/admin/AdminRegulationsPage'
export { AdminRequestsPage } from '../pages/admin/AdminRequestsPage'
export { AdminUsersPage } from '../pages/admin/AdminUsersPage'
export { OrganizationalStructurePage } from '../pages/OrganizationalStructurePage'
export { DepartmentDetailsPage } from '../pages/admin/DepartmentDetailsPage'
export { DepartmentFormPage } from '../pages/admin/DepartmentFormPage'
export { EditUserPage } from '../pages/admin/EditUserPage'
export { RegulationDetailsPage } from '../pages/admin/RegulationDetailsPage'
export { RegulationFormPage } from '../pages/admin/RegulationFormPage'
export { RequestDetailsPage } from '../pages/admin/RequestDetailsPage'
export { UserDetailsPage } from '../pages/admin/UserDetailsPage'
