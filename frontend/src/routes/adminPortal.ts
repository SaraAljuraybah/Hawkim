/*
 * The admin portal, loaded as ONE separate chunk (route-based code splitting): its
 * layout and every /admin page. Imported lazily from routes/guards.tsx and App.tsx.
 */
export { AdminLayout } from '../components/layout/AdminLayout'
export { AddUserPage } from '../pages/admin/AddUserPage'
export { AdminDepartmentsPage } from '../pages/admin/AdminDepartmentsPage'
export { AdminRegulationsPage } from '../pages/admin/AdminRegulationsPage'
export { AdminRequestsPage } from '../pages/admin/AdminRequestsPage'
export { AdminUsersPage } from '../pages/admin/AdminUsersPage'
export { DepartmentDetailsPage } from '../pages/admin/DepartmentDetailsPage'
export { DepartmentFormPage } from '../pages/admin/DepartmentFormPage'
export { RegulationDetailsPage } from '../pages/admin/RegulationDetailsPage'
export { RegulationFormPage } from '../pages/admin/RegulationFormPage'
export { RequestDetailsPage } from '../pages/admin/RequestDetailsPage'
export { UserDetailsPage } from '../pages/admin/UserDetailsPage'
