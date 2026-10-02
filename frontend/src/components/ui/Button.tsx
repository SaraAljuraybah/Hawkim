import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

/**
 * - primary:   maroon filled (main call to action on light backgrounds)
 * - secondary: maroon outline (supporting action on light backgrounds)
 * - accent:    gold filled with maroon text (call to action on maroon backgrounds)
 */
type ButtonVariant = 'primary' | 'secondary' | 'accent'
type ButtonSize = 'md' | 'lg'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Show a trailing arrow icon. */
  withArrow?: boolean
  className?: string
  children: ReactNode
}

type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & { href: string }
type NativeButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined }

export type ButtonProps = LinkButtonProps | NativeButtonProps

const base =
  'group inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
  'transition-colors duration-200'

const variants: Record<ButtonVariant, string> = {
  primary:
    'border border-maroon bg-maroon text-offwhite hover:border-maroon-secondary hover:bg-maroon-secondary',
  secondary: 'border border-maroon/40 bg-transparent text-maroon hover:border-maroon hover:bg-maroon/5',
  // On maroon backgrounds the default maroon focus ring would be invisible, so use light gold.
  accent:
    'border border-gold bg-gold text-maroon hover:border-gold-light hover:bg-gold-light ' +
    'focus-visible:outline-gold-light',
}

const sizes: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

/** Renders an `<a>` when `href` is given, otherwise a `<button>`. */
export function Button({
  variant = 'primary',
  size = 'md',
  withArrow = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`

  const content = (
    <>
      {children}
      {withArrow && (
        <ArrowRight
          aria-hidden="true"
          className="size-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
        />
      )}
    </>
  )

  if (rest.href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={classes}>
        {content}
      </a>
    )
  }

  return (
    <button type="button" {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes}>
      {content}
    </button>
  )
}
