import { Button } from '../ui/Button'
import { demoAccountsEn } from '../../content/demoAccounts.en'
import { usersEn } from '../../content/users.en'
import { useUsers } from '../../state/usersContext'

interface DemoAccountsProps {
  /** Fills the sign-in form's email field. */
  onPick: (email: string) => void
}

/**
 * DEVELOPMENT ONLY: the sample accounts (name, permissions, email) under the
 * sign-in form, each with a button that fills in its email. Deleted users are
 * not listed. The Sign In page loads this only in development (import.meta.env.DEV),
 * so it is not part of the production build.
 */
export default function DemoAccounts({ onPick }: DemoAccountsProps) {
  const content = demoAccountsEn
  const { activeUsers } = useUsers()

  return (
    <section aria-labelledby="demo-accounts-title" className="mt-8 rounded-xl border border-dashed border-text-gray/40 p-4">
      <h2 id="demo-accounts-title" className="text-base">
        {content.title}
      </h2>
      <p className="mt-1 text-sm text-text-gray">{content.note}</p>
      <ul className="mt-3 divide-y divide-beige">
        {activeUsers.map((user) => (
          <li key={user.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-maroon">
                {user.name}
                <span className="font-normal text-text-gray">
                  {' · '}
                  {user.permissions.length > 0
                    ? user.permissions.map((permission) => usersEn.permissions[permission]).join(', ')
                    : usersEn.employee}
                </span>
              </p>
              <p className="break-all text-text-gray">{user.email}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              aria-label={content.useLabel.replace('{name}', user.name)}
              onClick={() => onPick(user.email)}
            >
              {content.use}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
