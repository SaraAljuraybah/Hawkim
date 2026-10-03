import { useEffect } from 'react'

/**
 * Sets the browser tab title while the calling page is shown.
 * Pass `undefined` to leave the title to a child (e.g. an embedded Not Found page).
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}
