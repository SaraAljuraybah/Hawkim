/**
 * Shortest password the form accepts. It matches supabase/config.toml; the browser can't read
 * the hosted project's setting, so a stricter one comes back as a 'weak-password' failure.
 */
export const PASSWORD_MIN_LENGTH = 6

export interface NewPasswordProblems {
  password?: 'required' | 'too-short'
  confirm?: 'required' | 'mismatch'
}

/** What's wrong with the two password fields, if anything. */
export function newPasswordProblems(password: string, confirm: string): NewPasswordProblems {
  return {
    ...(!password ? { password: 'required' as const } : password.length < PASSWORD_MIN_LENGTH ? { password: 'too-short' as const } : {}),
    ...(!confirm ? { confirm: 'required' as const } : confirm !== password ? { confirm: 'mismatch' as const } : {}),
  }
}
