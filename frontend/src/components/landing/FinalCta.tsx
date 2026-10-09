import type { LandingContent } from '../../content/types'
import { Button } from '../ui/Button'
import { HexFragment } from '../ui/HexFragment'
import { Section } from '../ui/Section'
import { SectionHeading } from '../ui/SectionHeading'
import type { RequestLink } from './requestLink'

interface FinalCtaProps {
  content: LandingContent['finalCta']
  /** Request Hawkim (opens an email). */
  request: RequestLink
}

/** Closing call to action on a maroon panel. */
export function FinalCta({ content, request }: FinalCtaProps) {
  return (
    <Section labelledBy="cta-title">
      <div className="relative overflow-hidden rounded-2xl bg-maroon px-6 py-12 sm:px-12 lg:py-16">
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
          <Button href={request.href} variant="accent" size="lg" withArrow className="mt-8">
            {request.label}
          </Button>
          {/* For visitors without an email app: the address itself */}
          <p className="mt-4 text-center text-sm text-beige">
            {content.emailLine.split('{email}')[0]}
            <a
              href={request.href}
              className="rounded-sm font-medium break-all text-offwhite underline underline-offset-2 hover:text-gold-light focus-visible:outline-gold-light"
            >
              {request.email}
            </a>
            {content.emailLine.split('{email}')[1]}
          </p>
        </div>
      </div>
    </Section>
  )
}
