import { useNavigate } from 'react-router-dom'
import { DepartmentGrid } from '../components/departments/DepartmentGrid'
import { departmentsEn } from '../content/departments.en'
import type { Department, DepartmentId } from '../data/mock/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { getDepartmentState } from '../lib/departments'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useDepartments } from '../state/departmentsContext'
import { useMyRequests } from '../state/requestsContext'

/** Where opening a department takes the user. */
const AFTER_OPEN_PATH = '/dashboard'

/** Departments ("/departments"): a grid of department cards with the user's state and actions. */
export function DepartmentsPage() {
  const content = departmentsEn
  useDocumentTitle(content.pageTitle)
  const navigate = useNavigate()

  // States come from the shared stores, so they update as soon as requests change.
  const requests = useMyRequests()
  const { activeDepartments } = useDepartments()
  const { activeDepartment, userDepartments, setActiveDepartment } = useActiveDepartment()
  const getState = (department: Department) =>
    getDepartmentState(department.id, activeDepartment.id, userDepartments, requests)

  function openDepartment(id: DepartmentId) {
    setActiveDepartment(id)
    navigate(AFTER_OPEN_PATH)
  }

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      <div className="mt-8">
        <DepartmentGrid departments={activeDepartments} content={content} getState={getState} onOpen={openDepartment} />
      </div>
    </>
  )
}
