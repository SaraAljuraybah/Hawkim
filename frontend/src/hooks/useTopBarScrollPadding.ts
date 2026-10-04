import { useEffect } from 'react'

/**
 * Keeps focused or scrolled-to elements clear of the sticky top bar (64px), e.g. when
 * a form moves focus to its first invalid field. For the signed-in shells only.
 */
export function useTopBarScrollPadding() {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.scrollPaddingTop
    root.style.scrollPaddingTop = '5rem'
    return () => {
      root.style.scrollPaddingTop = previous
    }
  }, [])
}
