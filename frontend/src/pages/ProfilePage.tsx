import { useRef, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { ChangePasswordDialog } from '../components/profile/ChangePasswordDialog'
import { Card } from '../components/ui/Card'
import { controlClasses } from '../components/ui/useFieldIds'
import { profileEn } from '../content/profile.en'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { divisionLabel } from '../lib/userAdmin'
import { useDepartments } from '../state/departmentsContext'
import { useCurrentUser } from '../state/sessionContext'
import { useAdminRoleLabel } from '../state/superAdminContext'

/**
 * My Profile: the signed-in person's own information, read-only, and Change Password (a dialog). The same
 * page in the employee app ("/profile") and the admin portal ("/admin/profile", `admin`: only the tab
 * title differs).
 */
export function ProfilePage({ admin = false }: { admin?: boolean }) {
  const content = profileEn
  useDocumentTitle(admin ? content.adminPageTitle : content.pageTitle)
  const user = useCurrentUser()
  const department = useDepartments().getDepartment(user.departmentId)
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)
  const changeRef = useRef<HTMLButtonElement>(null)
  // In the admin portal an administrator's role is "Super Admin" or "Admin" (who the Super Admin is now).
  const adminLabel = useAdminRoleLabel(user)
  const roles = user.permissions.map((permission) => (permission === 'admin' && adminLabel ? adminLabel : content.roles[permission]))
  // An Admin manages the whole organization: no position, division or department (whatever the account
  // still holds), as everywhere else in the interface.
  const isAdmin = user.permissions.includes('admin')
  // Same order as Add User. A value that is missing or blank shows content.none, the same way for every field.
  const details = [
    [content.fields.name, user.name],
    [content.fields.email, user.email],
    [content.fields.phone, user.phone],
    ...(isAdmin ? [] : [[content.fields.division, divisionLabel(department)], [content.fields.department, department?.name], [content.fields.position, user.position]]),
    [content.fields.roles, roles.join(', ')],
  ].map(([label, value]) => [label, value?.trim() || content.none] as const)

  return (
    <>
      <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>
      {/* After changing the password (live region stays mounted) */}
      <div role="status">
        {changed && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {content.password.changed}
          </p>
        )}
      </div>
      <Card className="mt-6">
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
              <div className={`flex h-11 max-w-md items-center justify-between gap-3 ${controlClasses()}`}>
                <span aria-hidden="true" className="tracking-widest">••••••••</span>
                <button
                  ref={changeRef}
                  type="button"
                  aria-label={content.password.changeLabel}
                  onClick={() => {
                    setChanged(false)
                    setChanging(true)
                  }}
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
        onChanged={() => setChanged(true)}
        onClose={() => {
          setChanging(false)
          changeRef.current?.focus()
        }}
      />
    </>
  )
}
