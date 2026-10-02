import type { ReactNode } from 'react'

interface ContainerProps {
  children: ReactNode
  className?: string
}

/** Centres content with the site-wide max width and side gutters (16px on phones). */
export function Container({ children, className = '' }: ContainerProps) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>
}
