import { useRef, useState } from 'react'
import { ChangePasswordDialog } from '../components/profile/ChangePasswordDialog'
import { Card } from '../components/ui/Card'
import { controlClasses } from '../components/ui/useFieldIds'
import { profileEn } from '../content/profile.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useActiveDepartment } from '../state/activeDepartmentContext'
import { useCurrentUser } from '../state/sessionContext'

/** My Profile ("/profile"): the signed-in employee's own information, read-only, and Change Password (a dialog). */
export function ProfilePage() {
  const content = profileEn
  useDocumentTitle(content.pageTitle)
  const user = useCurrentUser()
  const { homeDepartment } = useActiveDepartment()
  const [changing, setChanging] = useState(false)
  const changeRef = useRef<HTMLButtonElement>(null)
  const roles = user.permissions.flatMap((permission) => (permission === 'admin' ? [] : [content.roles[permission]]))
  // Same order as Add User. A value that is missing or blank shows content.none, the same way for every field.
  const details = [
    [content.fields.name, user.name],
    [content.fields.email, user.email],
    [content.fields.phone, user.phone],
    [content.fields.division, homeDepartment.divisionId],
    [content.fields.department, homeDepartment.name],
    [content.fields.position, user.position],
    [content.fields.roles, roles.join(', ')],
  ].map(([label, value]) => [label, value?.trim() || content.none] as const)

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <Card className="mt-6 max-w-2xl">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-bold text-maroon">{label}</dt>
              <dd className="min-w-0 break-words text-maroon max-sm:mb-1">{value}</dd>
            </div>
          ))}
          {/* Last row, under a divider: a field-style box with hidden dots and the Change action */}
          <div className="mt-1 grid gap-x-6 gap-y-3 border-t border-beige pt-4 sm:col-span-2 sm:grid-cols-subgrid sm:items-center">
            <dt className="font-bold text-maroon">{content.fields.password}</dt>
            <dd className="min-w-0">
              <div className={`flex h-11 items-center justify-between gap-3 ${controlClasses()}`}>
                <span aria-hidden="true" className="tracking-widest">••••••••</span>
                <button
                  ref={changeRef}
                  type="button"
                  aria-label={content.password.changeLabel}
                  onClick={() => setChanging(true)}
                  className="rounded-sm px-2 py-1 font-medium text-maroon underline-offset-2 hover:underline"
                >
                  {content.password.change}
                </button>
              </div>
            </dd>
          </div>
        </dl>
      </Card>
      <ChangePasswordDialog
        open={changing}
        content={content.password.dialog}
        onClose={() => {
          setChanging(false)
          changeRef.current?.focus()
        }}
      />
    </>
  )
}
