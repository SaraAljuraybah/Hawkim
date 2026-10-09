import type { LandingContent } from '../../content/types'
import { Button } from '../ui/Button'
import { Container } from '../ui/Container'
import { HexFragment } from '../ui/HexFragment'
import { DashboardPreview } from './DashboardPreview'
import type { RequestLink } from './requestLink'

interface HeroProps {
  content: LandingContent['hero']
  /** Request Hawkim: the primary call to action (opens an email). */
  request: RequestLink
}

/** Opening section: headline, calls to action and the dashboard preview. */
export function Hero({ content, request }: HeroProps) {
  return (
    <section
      id="home"
      aria-labelledby="hero-title"
      className="relative scroll-mt-21 overflow-hidden pt-10 pb-14 sm:pt-14 lg:pt-16 lg:pb-16"
    >
      {/* Background decoration: soft maroon hexagons and thin gold lines */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <HexFragment className="absolute -top-24 -right-24 size-[34rem] text-maroon/[0.07]" strokeWidth={2} />
        <HexFragment
          open={false}
          className="absolute top-40 right-[18%] hidden size-56 text-maroon/[0.08] lg:block"
          strokeWidth={1.5}
        />
        <HexFragment className="absolute -bottom-32 -left-24 size-80 text-maroon/[0.05]" strokeWidth={2} />
        <svg className="absolute right-0 bottom-12 hidden h-56 w-[46rem] text-gold/50 lg:block" fill="none">
          <line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" />
          <line x1="15%" y1="100%" x2="100%" y2="18%" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
      </div>

      {/* Text about 45%, the preview about 55% (it fills its column) */}
      <Container className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] lg:gap-12 xl:gap-16">
        {/* Text column */}
        <div>
          <h1 id="hero-title" className="text-5xl leading-[1.05] tracking-tight sm:text-6xl">
            {content.headlineLines.map((line, index) => (
              <span
                key={line}
                className={`block ${index === content.headlineLines.length - 1 ? 'text-maroon-secondary' : ''}`}
              >
                {line}
              </span>
            ))}
          </h1>

          <span aria-hidden="true" className="mt-8 block h-0.5 w-16 bg-gold" />

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-gray">{content.subtitle}</p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button href={request.href} size="lg" withArrow>
              {request.label}
            </Button>
            <Button href={content.secondaryCta.href} size="lg" variant="secondary">
              {content.secondaryCta.label}
            </Button>
          </div>

          <p className="mt-8 max-w-lg text-sm leading-relaxed text-text-gray">{content.regulatoryNote}</p>
        </div>

        {/* Decorative product preview — desktop only */}
        <div className="relative hidden lg:block">
          <span aria-hidden="true" className="absolute -top-5 -left-5 h-24 w-px bg-gold/70" />
          <span aria-hidden="true" className="absolute -top-5 -left-5 h-px w-24 bg-gold/70" />
          <DashboardPreview content={content.preview} />
        </div>
      </Container>
    </section>
  )
}
