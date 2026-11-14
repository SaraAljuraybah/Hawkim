/*
 * Ends an open tab's session once the signed-in person's profile is no longer active (an Admin deactivated
 * them with Delete Staff). The database already refuses them everything from that moment, even with the
 * access token this tab still holds; this only makes the app say so instead of showing empty pages.
 * Checked when the tab is shown or focused again, and every minute while it is open. A check that can't
 * reach the server never signs anyone out.
 */

/** Whether the profile is still active: true, false (deactivated or gone), or undefined when it couldn't be checked. */
export type ProfileCheck = (userId: string) => Promise<boolean | undefined>

/** What the watch listens to; the browser's by default (replaced in tests). */
export interface WatchEnvironment {
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  addEventListener: (type: 'focus' | 'visibilitychange', callback: () => void) => void
  removeEventListener: (type: 'focus' | 'visibilitychange', callback: () => void) => void
  isVisible: () => boolean
}

export const PROFILE_CHECK_INTERVAL_MS = 60_000

function browserEnvironment(): WatchEnvironment {
  return {
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    addEventListener: (type, callback) => (type === 'focus' ? window : document).addEventListener(type, callback),
    removeEventListener: (type, callback) => (type === 'focus' ? window : document).removeEventListener(type, callback),
    isVisible: () => document.visibilityState === 'visible',
  }
}

/**
 * Watches `userId`'s profile; calls `onEnded` once, when a check says it is no longer active. Returns a
 * function that stops watching.
 */
export function watchActiveProfile(
  userId: string,
  check: ProfileCheck,
  onEnded: () => void,
  environment: WatchEnvironment = browserEnvironment(),
): () => void {
  let stopped = false
  let checking = false
  async function run() {
    if (stopped || checking || !environment.isVisible()) return
    checking = true
    try {
      const active = await check(userId)
      if (active === false && !stopped) {
        stop()
        onEnded()
      }
    } finally {
      checking = false
    }
  }
  const onShown = () => void run()
  const handle = environment.setInterval(onShown, PROFILE_CHECK_INTERVAL_MS)
  environment.addEventListener('focus', onShown)
  environment.addEventListener('visibilitychange', onShown)
  function stop() {
    if (stopped) return
    stopped = true
    environment.clearInterval(handle)
    environment.removeEventListener('focus', onShown)
    environment.removeEventListener('visibilitychange', onShown)
  }
  return stop
}
