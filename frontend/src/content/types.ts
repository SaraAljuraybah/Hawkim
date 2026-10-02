/*
 * Shape of the landing page content.
 * Every language file (landing.en.ts now, landing.ar.ts later) implements
 * `LandingContent`, so components never contain hard-coded text.
 */

/** Icons are referenced by name; see `src/components/icons.ts` for the mapping. */
export type IconName =
  | 'governance'
  | 'compliance'
  | 'intelligence'
  | 'workflow'
  | 'regulatory'
  | 'organization'
  | 'traceability'
  | 'dashboard'
  | 'requests'
  | 'sops'
  | 'departments'
  | 'employees'
  | 'signOut'
  | 'submitRequest'

export interface NavLink {
  label: string
  /** In-page anchor, e.g. `#about`. */
  href: string
}

export interface CallToAction {
  label: string
  href: string
}

export interface CardContent {
  icon: IconName
  title: string
  description: string
}

/** Sample data shown in the decorative dashboard preview in the hero. */
export interface DashboardPreviewContent {
  /** Name of the app window shown in the preview's title bar. */
  windowTitle: string
  sidebar: { icon: IconName; label: string; active?: boolean }[]
  signOut: { icon: IconName; label: string }
  greeting: string
  stats: { icon: IconName; value: string; label: string; caption: string }[]
  recentActivity: {
    title: string
    items: { title: string; meta: string; status: string }[]
  }
  quickActions: {
    title: string
    items: { icon: IconName; label: string }[]
  }
}

export interface LandingContent {
  /** Visually hidden link that lets keyboard users jump past the navbar. */
  skipLink: string
  brand: {
    /** Alt text for the logo. */
    logoAlt: string
  }
  nav: {
    ariaLabel: string
    links: NavLink[]
    signIn: CallToAction
    openMenu: string
    closeMenu: string
  }
  hero: {
    eyebrow: string
    /** Rendered one per line inside the page's single <h1>. */
    headlineLines: string[]
    subtitle: string
    primaryCta: CallToAction
    secondaryCta: CallToAction
    regulatoryNote: string
    preview: DashboardPreviewContent
  }
  about: {
    eyebrow: string
    title: string
    description: string
    pillars: CardContent[]
  }
  features: {
    eyebrow: string
    title: string
    subtitle: string
    items: CardContent[]
  }
  mission: {
    /** Accessible name for the section (it has no visible heading). */
    ariaLabel: string
    statement: string
  }
  finalCta: {
    eyebrow: string
    title: string
    text: string
    cta: CallToAction
  }
  footer: {
    navAriaLabel: string
    links: NavLink[]
    copyright: string
    academicNote: string
  }
}
