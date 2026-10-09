import type { LandingContent } from '../../content/types'
import { HexFragment } from '../ui/HexFragment'
import { Section } from '../ui/Section'

interface MissionProps {
  content: LandingContent['mission']
}

/** Beige band with the Hawkim mission statement (a statement, not a testimonial). */
export function Mission({ content }: MissionProps) {
  return (
    <Section
      ariaLabel={content.ariaLabel}
      className="bg-beige"
      decoration={
        <>
          <HexFragment className="absolute top-1/2 -left-20 size-80 -translate-y-1/2 text-maroon/[0.07]" strokeWidth={2} />
          <HexFragment
            open={false}
            className="absolute top-1/2 -right-16 size-64 -translate-y-1/2 text-maroon/[0.06]"
            strokeWidth={2}
          />
        </>
      }
    >
      <div className="mx-auto max-w-4xl text-center">
        {/* Small geometric divider: gold line · gold hexagon · gold line */}
        <div aria-hidden="true" className="mb-6 flex items-center justify-center gap-4">
          <span className="h-px w-12 bg-gold" />
          <HexFragment open={false} className="size-6 text-gold" strokeWidth={1.75} />
          <span className="h-px w-12 bg-gold" />
        </div>
        <p className="text-2xl leading-snug font-semibold tracking-tight text-maroon sm:text-3xl lg:text-4xl">
          {content.statement}
        </p>
      </div>
    </Section>
  )
}
