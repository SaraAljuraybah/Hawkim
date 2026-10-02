import type { LucideIcon } from 'lucide-react'

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
  /** Heading level for the card title (h3 inside an h2 section). */
  as?: 'h3' | 'h4'
  className?: string
}

/** Card with an outlined icon, a title and a short description. */
export function FeatureCard({
  icon: Icon,
  title,
  description,
  as: Heading = 'h3',
  className = '',
}: FeatureCardProps) {
  return (
    <article
      className={`group relative h-full overflow-hidden rounded-xl border border-beige bg-white/70 p-6 sm:p-7 ${className}`}
    >
      {/* Thin gold line along the top that extends on hover — a quiet geometric accent */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-25 bg-gold motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-x-100"
      />
      <span
        aria-hidden="true"
        className="mb-5 inline-flex size-12 items-center justify-center rounded-lg border border-gold-light/60 bg-beige text-maroon"
      >
        <Icon className="size-6" strokeWidth={1.5} />
      </span>
      <Heading className="text-lg leading-snug">{title}</Heading>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-text-gray">{description}</p>
    </article>
  )
}
