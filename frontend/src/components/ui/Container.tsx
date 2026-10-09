import type { ReactNode } from 'react'

interface ContainerProps {
  children: ReactNode
  className?: string
}

/**
 * Centres landing page content with the site-wide max width (1440px) and side gutters:
 * 24px on phones, 32px on tablets, 48px on desktop.
 */
export function Container({ children, className = '' }: ContainerProps) {
  return <div className={`mx-auto w-full max-w-[90rem] px-6 md:px-8 lg:px-12 ${className}`}>{children}</div>
}
