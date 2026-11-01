import { Card } from '../components/ui/Card'
import { profileEn } from '../content/profile.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'

/** My Profile ("/profile"): the signed-in employee's own information, read-only. */
export function ProfilePage() {
  const content = profileEn
  useDocumentTitle(content.pageTitle)
  const user = useCurrentUser()
  const { homeDepartment } = useActiveDepartment()
  const roles = user.permissions.flatMap((permission) => (permission === 'admin' ? [] : [content.roles[permission]]))
  const details = [
    [content.fields.name, user.name],
    [content.fields.email, user.email],
    [content.fields.department, homeDepartment.name],
    [content.fields.division, homeDepartment.divisionId || content.none],
    [content.fields.roles, roles.join(', ') || content.none],
  ]

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <Card title={content.detailsTitle} titleId="profile-details-title" className="mt-6 max-w-2xl">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-gray">{label}</dt>
              <dd className="min-w-0 break-words text-maroon max-sm:mb-1">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  )
}
