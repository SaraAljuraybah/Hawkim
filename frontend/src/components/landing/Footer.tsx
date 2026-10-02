import type { LandingContent } from '../../content/types'
import { Container } from '../ui/Container'
import { Logo } from '../ui/Logo'

interface FooterProps {
  content: LandingContent['footer']
  logoAlt: string
}

/** Site footer: mark logo, section links, copyright and academic note. */
export function Footer({ content, logoAlt }: FooterProps) {
  return (
    <footer className="border-t border-gold-light/40 bg-beige">
      <Container className="py-12">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <a href="#home" className="rounded-md">
            <Logo variant="mark" alt={logoAlt} className="h-12" />
          </a>

          <nav aria-label={content.navAriaLabel}>
            <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3">
              {content.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="rounded-sm text-sm font-medium text-maroon underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 border-t border-maroon/10 pt-6 text-center text-sm text-text-gray md:flex-row md:justify-between md:text-left">
          <p>{content.copyright}</p>
          <p>{content.academicNote}</p>
        </div>
      </Container>
    </footer>
  )
}
