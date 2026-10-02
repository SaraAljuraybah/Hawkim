import type { LandingContent } from '../../content/types'
import { Button } from '../ui/Button'
import { HexFragment } from '../ui/HexFragment'
import { Section } from '../ui/Section'
import { SectionHeading } from '../ui/SectionHeading'

interface FinalCtaProps {
  content: LandingContent['finalCta']
}

/** Closing call to action on a maroon panel. */
export function FinalCta({ content }: FinalCtaProps) {
  return (
    <Section labelledBy="cta-title">
      <div className="relative overflow-hidden rounded-2xl bg-maroon px-6 py-16 sm:px-12 lg:py-20">
        {/* Decoration: faint hexagons and thin gold lines */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <HexFragment className="absolute -top-20 -right-16 size-80 text-maroon-secondary" strokeWidth={2} />
          <HexFragment open={false} className="absolute -bottom-24 -left-16 size-72 text-maroon-secondary" strokeWidth={2} />
          <span className="absolute top-10 left-10 hidden h-px w-24 bg-gold/60 sm:block" />
          <span className="absolute right-10 bottom-10 hidden h-px w-24 bg-gold/60 sm:block" />
        </div>

        <div className="relative flex flex-col items-center">
          <SectionHeading
            id="cta-title"
            tone="dark"
            eyebrow={content.eyebrow}
            title={content.title}
            subtitle={content.text}
          />
          <Button href={content.cta.href} variant="accent" size="lg" withArrow className="mt-10">
            {content.cta.label}
          </Button>
        </div>
      </div>
    </Section>
  )
}
