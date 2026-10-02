import type { DashboardStatKey } from '../data/mock/types'

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
    /** `status` is optional: items without one show no badge. */
    items: { title: string; meta: string; status?: string }[]
  }
  quickActions: {
    title: string
    items: { icon: IconName; label: string }[]
  }
}

export interface LandingContent {
  /** Browser tab title for the landing page. */
  pageTitle: string
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

/* ---------- Authentication pages ---------- */

export interface LinkContent {
  label: string
  href: string
}

export interface SignInContent {
  /** Browser tab title. */
  pageTitle: string
  brand: {
    logoAlt: string
    /** Rendered one per line under the logo. */
    taglineLines: string[]
    /** Plain-text note at the bottom of the brand panel (no emblems or logos). */
    regulatoryNote: string
  }
  title: string
  subtitle: string
  email: { label: string; placeholder: string }
  password: { label: string; placeholder: string; showLabel: string; hideLabel: string }
  forgotPassword: LinkContent
  submit: { label: string; loadingLabel: string }
  errors: {
    emailRequired: string
    emailInvalid: string
    passwordRequired: string
  }
  /** Messages for the result returned by the auth service. */
  results: {
    notConnected: string
  }
  /** "By signing in, you agree to our {terms} and {privacy}." */
  legal: {
    prefix: string
    terms: LinkContent
    conjunction: string
    privacy: LinkContent
    suffix: string
  }
}

/* ---------- Not Found page ---------- */

export interface NotFoundContent {
  /** Browser tab title. */
  pageTitle: string
  logoAlt: string
  title: string
  text: string
  homeLink: LinkContent
}

/* ---------- Signed-in app: shell (sidebar + top bar) ---------- */

export interface AppNavItem {
  label: string
  /** Route path, e.g. `/dashboard`. */
  href: string
  icon: IconName
}

export interface AppShellContent {
  /** Visually hidden link that lets keyboard users jump past the navigation. */
  skipLink: string
  /** Product name shown as text next to the logo mark in the sidebar. */
  brandName: string
  /** Accessible name of the sidebar logo link. */
  homeLinkLabel: string
  navAriaLabel: string
  nav: AppNavItem[]
  signOut: AppNavItem
  notificationsLabel: string
  openMenu: string
  closeMenu: string
  /** Accessible name of the mobile navigation drawer. */
  drawerLabel: string
}

/* ---------- Signed-in app: dashboard ---------- */

export interface DashboardContent {
  /** Browser tab title. */
  pageTitle: string
  /** Greeting by local time of day; `{name}` is replaced with the user's first name. */
  greetings: { morning: string; afternoon: string; evening: string }
  subtitle: string
  /** Label, sublabel and icon for each statistic (values come from the data). */
  stats: Record<DashboardStatKey, { label: string; sublabel: string; icon: IconName }>
  recentActivity: { title: string }
  quickActions: {
    title: string
    primary: AppNavItem
    secondary: AppNavItem[]
  }
}

/* ---------- Signed-in app: SOPs list ---------- */

export type SopTabKey = 'all' | 'myDepartment' | 'recent'

export interface SopsContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  subtitle: string
  /** Accessible name of the tab list. */
  tabsLabel: string
  tabs: Record<SopTabKey, string>
  viewToggle: { label: string; grid: string; list: string }
  /** Column headings for the list view. */
  columns: { code: string; title: string; department: string; version: string; lastUpdated: string }
  /** `{version}` is replaced with the version number, e.g. "Version 2.1". */
  versionTemplate: string
  /** Shown when a tab has no SOPs. */
  empty: string
}
