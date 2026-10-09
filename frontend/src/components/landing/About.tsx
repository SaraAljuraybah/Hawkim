import type { LandingContent } from '../../content/types'
import { icons } from '../icons'
import { FeatureCard } from '../ui/FeatureCard'
import { HexFragment } from '../ui/HexFragment'
import { Section } from '../ui/Section'
import { SectionHeading } from '../ui/SectionHeading'

interface AboutProps {
  content: LandingContent['about']
}

/** "What is Hawkim?" — short description and the three brand pillars. */
export function About({ content }: AboutProps) {
  return (
    <Section
      id="about"
      labelledBy="about-title"
      className="border-t border-beige"
      decoration={
        <HexFragment className="absolute top-16 -left-28 size-72 text-maroon/[0.05]" strokeWidth={2} />
      }
    >
      <SectionHeading
        id="about-title"
        eyebrow={content.eyebrow}
        title={content.title}
        subtitle={content.description}
      />

      <ul className="mt-10 grid gap-6 md:grid-cols-3">
        {content.pillars.map((pillar) => (
          <li key={pillar.title}>
            <FeatureCard icon={icons[pillar.icon]} title={pillar.title} description={pillar.description} />
          </li>
        ))}
      </ul>
    </Section>
  )
}
