import fullLogo from '../../assets/brand/hawkim-logo-full.png'
import markLogo from '../../assets/brand/hawkim-logo-mark.png'

type LogoVariant = 'full' | 'mark'

interface LogoProps {
  /** `full` = mark + Arabic & English wordmark, `mark` = symbol only (for small spaces). */
  variant?: LogoVariant
  /** Accessible name. Pass an empty string when the logo is purely decorative. */
  alt: string
  /** Sizing classes. Set a HEIGHT only (e.g. `h-10`); the width follows automatically. */
  className?: string
}

const sources: Record<LogoVariant, string> = {
  full: fullLogo,
  mark: markLogo,
}

/**
 * Hawkim logo.
 * Brand rules: never stretch, rotate, recolour, crop or add effects.
 * `w-auto` keeps the original aspect ratio, and no filters are applied.
 */
export function Logo({ variant = 'full', alt, className = 'h-10' }: LogoProps) {
  return (
    <img
      src={sources[variant]}
      alt={alt}
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  )
}
