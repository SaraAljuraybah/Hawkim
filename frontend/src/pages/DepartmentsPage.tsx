import { DepartmentGrid } from '../components/departments/DepartmentGrid'
import { departmentsEn } from '../content/departments.en'
import { departments } from '../data/mock/departments'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** Departments ("/departments"): a grid of department cards. */
export function DepartmentsPage() {
  const content = departmentsEn
  useDocumentTitle(content.pageTitle)

  // TODO: Load departments from the backend API.
  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      <div className="mt-8">
        <DepartmentGrid departments={departments} content={content} />
      </div>
    </>
  )
}
