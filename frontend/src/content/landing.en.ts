import type { LandingContent, NavLink } from './types'
import { appShellEn, dashboardEn } from './app.en'

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

  // Hawkim is installed in each organization's own environment, so organizations
  // request it by email; there's no public sign-up.
  request: {
    label: 'Request Hawkim',
    email: 'hawkimgp@gmail.com',
    subject: 'Hawkim request',
    body: [
      'Hello Hawkim team,',
      '',
      'We would like to request Hawkim for our organization.',
      '',
      'Organization:',
      'Contact person:',
      'Job title:',
      'Phone:',
      'Approximate number of users:',
      'Message:',
      '',
      'Thank you.',
    ].join('\n'),
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
      'Hawkim streamlines SOP workflows and supports regulatory compliance for pharmaceutical organizations regulated by the Saudi Food and Drug Authority (SFDA).',
    secondaryCta: { label: 'Explore Hawkim', href: '#about' },

    // Illustrative sample data for the decorative dashboard preview.
    preview: {
      windowTitle: 'Hawkim',
      // The default author account; reviewer navigation remains permission-dependent.
      sidebar: appShellEn.nav.filter((item) => item.href !== '/reviews').map((item) => ({
        icon: item.icon, label: item.label, active: item.href === '/dashboard',
      })),
      signOut: { icon: 'signOut', label: 'Sign Out' },
      greeting: 'Good morning, Sara',
      subtitle: dashboardEn.subtitle.replace('{department}', 'Information Technology'),
      user: { name: 'Sara Aljuraybah', initials: 'SA', department: 'Information Technology' },
      stats: [
        { icon: 'requests', value: '2', label: dashboardEn.stats.myRequests.label, caption: dashboardEn.stats.myRequests.sublabel },
        { icon: 'sops', value: '1', label: dashboardEn.stats.sops.label, caption: dashboardEn.stats.sops.sublabel },
        { icon: 'employees', value: '5', label: dashboardEn.stats.employees.label, caption: dashboardEn.stats.employees.sublabel },
      ],
      recentActivity: {
        title: 'Recent Activity',
        items: [
          {
            title: 'Your access request to Research & Development is under review',
            meta: '2 hours ago',
            status: 'Pending',
          },
          { title: 'Your access request to Pharmacovigilance was approved', meta: '1 day ago' },
          { title: 'Your request to access SOP-045 is under review', meta: '2 days ago', status: 'Pending' },
        ],
      },
      quickActions: {
        title: dashboardEn.quickActions.title,
        items: [dashboardEn.quickActions.primary, ...dashboardEn.quickActions.secondary.filter((item) => item.href !== '/reviews')],
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
          'AI-assisted tools that support review and compliance checks, while final decisions remain with specialists.',
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
    title: 'Bring Hawkim to your organization',
    text: 'Request Hawkim and our team will contact you to arrange a demo and setup.',
  },

  footer: {
    navAriaLabel: 'Footer',
    links: sectionLinks,
    copyright: '© 2026 Hawkim. All rights reserved.',
    academicNote: 'A graduation project — King Saud University.',
  },
}
