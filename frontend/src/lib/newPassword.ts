/**
 * Shortest password the form accepts. It matches supabase/config.toml; the browser can't read
 * the hosted project's setting, so a stricter one comes back as a 'weak-password' failure.
 */
export const PASSWORD_MIN_LENGTH = 6

export interface NewPasswordProblems {
  password?: 'required' | 'too-short'
  confirm?: 'required' | 'mismatch'
}

export interface ChangePasswordProblems extends NewPasswordProblems {
  current?: 'required'
  /** Shown on the new password. */
  sameAsCurrent?: true
}

/** What's wrong with the Change Password fields (current, new and confirmation), if anything. */
export function changePasswordProblems(current: string, next: string, confirm: string): ChangePasswordProblems {
  const problems: ChangePasswordProblems = { ...(!current ? { current: 'required' as const } : {}), ...newPasswordProblems(next, confirm) }
  if (current && !problems.password && next === current) problems.sameAsCurrent = true
  return problems
}

/** What's wrong with the two password fields, if anything. */
export function newPasswordProblems(password: string, confirm: string): NewPasswordProblems {
  return {
    ...(!password ? { password: 'required' as const } : password.length < PASSWORD_MIN_LENGTH ? { password: 'too-short' as const } : {}),
    ...(!confirm ? { confirm: 'required' as const } : confirm !== password ? { confirm: 'mismatch' as const } : {}),
  }
}
