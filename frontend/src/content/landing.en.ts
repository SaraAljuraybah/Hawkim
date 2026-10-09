import type { LandingContent, NavLink } from './types'

/*
 * English content for the public landing page.
 * All user-facing text lives here so an Arabic version (landing.ar.ts)
 * can be added later without touching the components.
 */

/** Sign In page route (client-side route, see App.tsx). */
const LOGIN_PATH = '/login'

/** Section anchors shared by the navbar and the footer. */
const sectionLinks: NavLink[] = [
  { label: 'Home', href: '#home' },
  { label: 'About', href: '#about' },
  { label: 'Features', href: '#features' },
]

export const landingEn: LandingContent = {
  pageTitle: 'Hawkim',

  skipLink: 'Skip to main content',

  brand: {
    logoAlt: 'Hawkim',
  },

  nav: {
    ariaLabel: 'Main',
    brandName: 'Hawkim',
    homeLinkLabel: 'Hawkim, home',
    links: sectionLinks,
    signIn: { label: 'Sign In', href: LOGIN_PATH },
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },

  hero: {
    headlineLines: ['Governance.', 'Compliance.', 'Intelligence.'],
    subtitle:
      'Streamline SOP workflows and support regulatory compliance — all in one centralized platform.',
    primaryCta: { label: 'Sign In to Hawkim', href: LOGIN_PATH },
    secondaryCta: { label: 'Explore Hawkim', href: '#about' },
    regulatoryNote:
      'Designed for pharmaceutical organizations regulated by the Saudi Food and Drug Authority (SFDA)',

    // Illustrative sample data for the decorative dashboard preview.
    preview: {
      windowTitle: 'Hawkim',
      sidebar: [
        { icon: 'dashboard', label: 'Dashboard', active: true },
        { icon: 'requests', label: 'My Requests' },
        { icon: 'sops', label: 'SOPs' },
        { icon: 'departments', label: 'Departments' },
      ],
      signOut: { icon: 'signOut', label: 'Sign Out' },
      greeting: 'Good morning, Sara',
      stats: [
        { icon: 'requests', value: '5', label: 'My Requests', caption: 'In Progress' },
        { icon: 'sops', value: '12', label: 'SOPs', caption: 'Accessible' },
        { icon: 'employees', value: '48', label: 'Employees', caption: 'Across the organization' },
      ],
      recentActivity: {
        title: 'Recent Activity',
        items: [
          {
            title: 'Your access request to Research & Development is under review',
            meta: '2 hours ago',
            status: 'Pending',
          },
          { title: 'You were added to the Quality Assurance department', meta: '1 day ago' },
          { title: 'Your request to access SOP-045 is under review', meta: '2 days ago', status: 'Pending' },
        ],
      },
      quickActions: {
        title: 'Quick Actions',
        items: [
          { icon: 'submitRequest', label: 'Submit a Request' },
          { icon: 'sops', label: 'View SOPs' },
          { icon: 'departments', label: 'View Departments' },
        ],
      },
    },
  },

  about: {
    eyebrow: 'About Hawkim',
    title: 'What is Hawkim?',
    description:
      'Hawkim is a centralized SOP workflow management and governance platform designed for pharmaceutical organizations regulated by the Saudi Food and Drug Authority (SFDA). It brings SOP review, approval, traceability, and AI-assisted regulatory compliance verification into one integrated environment.',
    pillars: [
      {
        icon: 'governance',
        title: 'Governance',
        description: 'Visibility, accountability and controlled processes across your organization.',
      },
      {
        icon: 'compliance',
        title: 'Compliance',
        description:
          'Support SFDA regulatory requirements with structured and consistent SOP management.',
      },
      {
        icon: 'intelligence',
        title: 'Intelligence',
        description:
          'AI-assisted tools that support review and compliance checks, while final decisions remain with people.',
      },
    ],
  },

  features: {
    eyebrow: 'Our Features',
    title: 'Core Capabilities',
    subtitle: 'Everything you need to manage, govern and ensure compliance — in one platform.',
    items: [
      {
        icon: 'workflow',
        title: 'SOP Workflow Management',
        description: 'Create, review, approve and manage SOPs with clear workflows and timelines.',
      },
      {
        icon: 'regulatory',
        title: 'Regulatory Compliance Support',
        description: 'Align SOPs with SFDA requirements through AI-assisted checks and guidance.',
      },
      {
        icon: 'organization',
        title: 'Centralized Organization Management',
        description: 'Manage departments, users, roles and permissions across your organization.',
      },
      {
        icon: 'traceability',
        title: 'Traceability & Version Control',
        description: 'Track changes, maintain revision history and keep complete audit trails.',
      },
    ],
  },

  mission: {
    ariaLabel: 'Our mission',
    statement: 'Empowering pharmaceutical organizations with smarter governance and stronger compliance.',
  },

  finalCta: {
    eyebrow: 'Get Started',
    title: 'Ready to streamline your SOP governance?',
    text: 'Join Hawkim and take the next step towards a more compliant and efficient organization.',
    cta: { label: 'Sign In to Hawkim', href: LOGIN_PATH },
  },

  footer: {
    navAriaLabel: 'Footer',
    links: sectionLinks,
    copyright: '© 2026 Hawkim. All rights reserved.',
    academicNote: 'A graduation project — King Saud University.',
  },
}
