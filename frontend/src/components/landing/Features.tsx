import type { LandingContent } from '../../content/types'
import { icons } from '../icons'
import { FeatureCard } from '../ui/FeatureCard'
import { HexFragment } from '../ui/HexFragment'
import { Section } from '../ui/Section'
import { SectionHeading } from '../ui/SectionHeading'

interface FeaturesProps {
  content: LandingContent['features']
}

/** "Core Capabilities" — the four main features of the platform. */
export function Features({ content }: FeaturesProps) {
  return (
    <Section
      id="features"
      labelledBy="features-title"
      className="border-t border-beige"
      decoration={
        <HexFragment className="absolute -right-32 bottom-0 size-96 text-maroon/[0.05]" strokeWidth={2} />
      }
    >
      <SectionHeading
        id="features-title"
        eyebrow={content.eyebrow}
        title={content.title}
        subtitle={content.subtitle}
      />

      <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {content.items.map((feature) => (
          <li key={feature.title}>
            <FeatureCard icon={icons[feature.icon]} title={feature.title} description={feature.description} />
          </li>
        ))}
      </ul>
    </Section>
  )
}
