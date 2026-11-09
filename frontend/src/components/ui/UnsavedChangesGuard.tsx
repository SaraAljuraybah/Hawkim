import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'

export interface UnsavedChangesText {
  title: string
  description: string
  /** Stays on the page with the changes kept. */
  keep: string
  /** Leaves without saving. */
  discard: string
}

interface UnsavedChangesGuardProps {
  /** Whether there are changes that would be lost. */
  when: boolean
  text: UnsavedChangesText
}

/**
 * While `when` is true, leaving the page asks first: a link or button that navigates inside Hawkim
 * (Cancel, Back, the sidebar) and the browser's Back and Forward show "Discard unsaved changes?";
 * reloading, closing the tab or typing another address show the browser's own confirmation (browsers
 * don't allow custom text there). Keep Editing stays with the changes kept; Discard Changes leaves.
 */
export function UnsavedChangesGuard({ when, text }: UnsavedChangesGuardProps) {
  useEffect(() => {
    if (!when) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])

  // useBlocker needs the app's data router (main.tsx); pages rendered in other routers (tests) skip it.
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  return dataRouter ? <NavigationBlocker when={when} text={text} /> : null
}

function NavigationBlocker({ when, text }: UnsavedChangesGuardProps) {
  // Only navigation to another page: changing the search or hash of this one keeps the form.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname)
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={text.title}
      description={text.description}
      cancelLabel={text.keep}
      confirmLabel={text.discard}
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  )
}
