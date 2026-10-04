import type { FileDropzoneText } from '../components/ui/FileDropzone'
import type {
  ComplianceResult,
  DashboardStatKey,
  Permission,
  RequestType,
  SopFileType,
  TimelineEventType,
} from '../data/mock/types'

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
  | 'mySops'
  | 'upload'

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
    /** The account was deleted by an admin. */
    noAccess: string
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
  /** Also show the item as active on pages below it (e.g. /requests/new under /requests). */
  matchSubpaths?: boolean
  /** Only shown to users with this permission (e.g. 'author'); everyone sees items without one. */
  permission?: Permission
}

/** The sidebar's content (employee app and admin portal). */
export interface SidebarContent {
  /** Product name shown as text next to the logo mark in the sidebar. */
  brandName: string
  /** Small label after the product name, e.g. "Admin" (admin portal only). */
  portalLabel?: string
  /** Accessible name of the sidebar logo link. */
  homeLinkLabel: string
  navAriaLabel: string
  nav: AppNavItem[]
  signOut: AppNavItem
  closeMenu: string
}

export interface AppShellContent extends SidebarContent {
  /** Visually hidden link that lets keyboard users jump past the navigation. */
  skipLink: string
  notificationsLabel: string
  openMenu: string
  /** Accessible name of the mobile navigation drawer. */
  drawerLabel: string
  departmentSwitcher: {
    /** Label before the department name (visible in the drawer, screen-reader only in the top bar). */
    label: string
    /** Accessible name of the department menu. */
    menuLabel: string
  }
}

/* ---------- Signed-in app: dashboard ---------- */

export interface DashboardContent {
  /** Browser tab title. */
  pageTitle: string
  /** Greeting by local time of day; `{name}` is replaced with the user's first name. */
  greetings: { morning: string; afternoon: string; evening: string }
  /** `{department}` is replaced with the active department's name. */
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

export type SopTabKey = 'all' | 'recent'

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
  /** Screen-reader label before the active department's name, e.g. "Department: ". */
  departmentLabel: string
  /** `{version}` is replaced with the version number, e.g. "Version 2.1". */
  versionTemplate: string
  /** Shown when the list is empty. */
  empty: string
  /** SOP detail page ("/sops/:id"). */
  detail: SopDetailContent
}

export interface SopDetailContent {
  /** `{code}` is replaced, e.g. "SOP-078 | Hawkim". */
  pageTitle: string
  back: LinkContent
  exportPdf: string
  /** Accessible title of the embedded viewer; `{code}` and `{title}` are replaced. */
  viewerTitle: string
  /** Shown when the browser can't display PDFs inline (common on phones). */
  fallback: { text: string; openPdf: string; newTabHint: string }
  docx: { text: string; download: string }
  /** Shown when a published SOP has no file available yet. */
  noFile: string
  /** `{department}` is replaced with the department name. */
  noAccess: { title: string; text: string; requestAccess: string }
  pendingAccess: { title: string; text: string }
}

/* ---------- Signed-in app: Departments ---------- */

export interface DepartmentsContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  subtitle: string
  /** Member count wording by plural form; `{count}` is replaced with the number. */
  memberCount: { one: string; other: string }
  /** The user's relationship with each department, and its actions. */
  states: {
    current: string
    member: string
    open: string
    accessRequested: string
    requestAccess: string
  }
}

/* ---------- Signed-in app: requests ---------- */

export interface SubmitRequestContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  subtitle: string
  fields: {
    type: { label: string; placeholder: string }
    department: { label: string; placeholder: string }
    title: { label: string; placeholder: string }
    description: { label: string; placeholder: string; /** `{count}` and `{max}` are replaced. */ counter: string }
    attachments: {
      label: string
      optionalTag: string
      hint: string
      dropPrompt: string
      browse: string
      remove: string
      typeError: string
      sizeError: string
    }
  }
  errors: {
    typeRequired: string
    departmentRequired: string
    titleRequired: string
    descriptionRequired: string
  }
  cancel: LinkContent
  submit: { label: string; loadingLabel: string }
  confirmation: {
    title: string
    text: string
    viewRequests: LinkContent
    submitAnother: string
  }
}

export type RequestTabKey = 'all' | 'pending' | 'approved' | 'rejected'

export interface MyRequestsContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  subtitle: string
  newRequest: LinkContent
  /** Accessible name of the tab list. */
  tabsLabel: string
  tabs: Record<RequestTabKey, string>
  cancelButton: string
  cancelDialog: { title: string; text: string; keep: string; confirm: string }
  /** Announced to screen readers after a request is cancelled. */
  cancelledAnnouncement: string
  /** Shown when a tab has no requests. */
  empty: string
}

export interface RequestsContent {
  /** Display label for each request type. */
  types: Record<RequestType, string>
  submit: SubmitRequestContent
  myRequests: MyRequestsContent
}

/* ---------- Searchable people picker ---------- */

/** The picker's own text (each form gives its label, hint and errors). */
export interface PeoplePickerContent {
  placeholder: string
  /** Shown when nothing matches the search. */
  noMatches: string
  /** Accessible name of the chip list; `{label}` is the field label. */
  selected: string
  /** Accessible name of a chip's remove button; `{name}` is replaced. */
  remove: string
  /** Announced to screen readers; `{name}` is replaced. */
  added: string
  removed: string
}

/* ---------- Author: My SOPs and Upload SOP ---------- */

export interface MySopsContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  /** `{department}` is replaced with the active department's name. */
  subtitle: string
  upload: LinkContent
  /** `{version}` is replaced, e.g. "Version 1.0". */
  versionTemplate: string
  /** Shown when a tab has no SOPs. */
  empty: string
  /** Announced after a successful upload. */
  uploadedMessage: string
  /** Label on SOPs the user co-authors. */
  coAuthorLabel: string
  /** On SOPs last checked against an older GVP version. */
  recheckLabel: string
}

export interface UploadSopContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  /** `{department}` is replaced with the active department's name. */
  subtitle: string
  fields: {
    title: { label: string; placeholder: string }
    department: { label: string }
    file: {
      label: string
      hint: string
      dropPrompt: string
      browse: string
      remove: string
      typeError: string
      sizeError: string
    }
    description: { label: string; placeholder: string; /** `{count}` and `{max}` are replaced. */ counter: string }
    /** Optional co-authors: other users with the Author permission. */
    coAuthors: { label: string; hint: string }
  }
  errors: { titleRequired: string; fileRequired: string }
  cancel: LinkContent
  submit: { label: string; loadingLabel: string }
}

/* ---------- Author: SOP workflow page ---------- */

/** Text for a single-file picker (FileDropzone) used in workflow dialogs. */
export interface SopFileFieldContent {
  label: string
  hint: string
  dropPrompt: string
  browse: string
  remove: string
  typeError: string
  sizeError: string
}

export interface SopWorkflowContent {
  /** `{code}` is replaced, e.g. "SOP-083 | Hawkim". */
  pageTitle: string
  back: LinkContent
  versionTemplate: string
  /** `{date}` is replaced. */
  lastUpdatedTemplate: string
  departmentLabel: string
  roles: { reviewer: string; approver: string; author: string; coAuthor: string; system: string }
  tracker: {
    label: string
    steps: { draft: string; 'in-review': string; 'in-approval': string; approved: string; published: string }
    returned: string
    /** Screen-reader state of each step. */
    srCompleted: string
    srCurrent: string
    srReturned: string
    /** Under In Review / In Approval while open; `{date}` is replaced. */
    due: string
    overdue: string
  }
  people: {
    title: string
    author: string
    coAuthors: string
    reviewers: string
    approvers: string
    /** After the current user's name. */
    you: string
    noCoAuthors: string
    /** Reviewers and approvers before the first submission. */
    notAssigned: string
    addCoAuthor: string
    remove: string
    /** Accessible name of a Remove button; `{name}` is replaced. */
    removeLabel: string
    decisions: { pending: string; completed: string; approved: string; returned: string }
  }
  file: {
    title: string
    types: Record<SopFileType, string>
    download: string
    viewInDirectory: string
  }
  actions: {
    title: string
    submit: string
    replace: string
    uploadNewVersion: string
    resubmit: string
    resubmitHint: string
    /** `{people}` is replaced, e.g. "Faisal Alharbi (Reviewer)". */
    waiting: string
    /** Follows the waiting text; `{date}` is replaced. */
    waitingDue: string
    approvedWaiting: string
    published: string
    /** Shown to co-authors; `{name}` is the main author. */
    authorOnly: string
    /** Why Submit / Resubmit is disabled: the check is running, or there's no completed check. */
    checkWaiting: string
    checkNeeded: string
    /** The completed check used an older GVP version; `{version}` is the current one. */
    checkCurrentNeeded: string
    /** Published SOPs: run a new check after the requirements change (PBI 29). */
    recheck: string
  }
  feedback: {
    title: string
    /** `{name}`, `{role}`, `{date}` and `{version}` are replaced. */
    description: string
  }
  comments: {
    title: string
    empty: string
    /** `{version}` is replaced. */
    versionHeading: string
  }
  timeline: {
    title: string
    events: Record<TimelineEventType, string>
    /** `{name}` is replaced. */
    by: string
    /** `{name}` is replaced. */
    to: string
    noteLabel: string
    /** Label for stage-due-date-set events, by stage. */
    stageDue: { review: string; approval: string }
    /** `{date}` is replaced. */
    due: string
    /** For co-author events; `{name}` is replaced. */
    subject: string
  }
  dialogs: {
    cancel: string
    fileField: SopFileFieldContent
    fileRequired: string
    submit: {
      title: string
      description: string
      reviewers: { label: string; hint: string }
      /** `unchecked`: `{names}` is replaced with the approvers unchecked because they became reviewers. */
      approvers: { label: string; hint: string; unchecked: string }
      /** `dueHint`: `{date}` is replaced with the due date if submitted now. */
      /** `dueHint`: `{date}` is replaced with the due date if submitted now. */
      reviewDays: { label: string; hint: string; dueHint: string }
      approvalDays: { label: string; hint: string }
      note: { label: string; placeholder: string; counter: string }
      errors: { reviewersRequired: string; approversRequired: string; daysInvalid: string }
      confirm: string
    }
    replace: { title: string; description: string; confirm: string }
    newVersion: { title: string; description: string; confirm: string }
    addCoAuthors: {
      title: string
      description: string
      label: string
      hint: string
      required: string
      confirm: string
    }
    /** `{name}` is replaced in the description. */
    removeCoAuthor: { title: string; description: string; keep: string; confirm: string }
    resubmit: {
      title: string
      description: string
      reviewersLabel: string
      approversLabel: string
      reviewDaysLabel: string
      approvalDaysLabel: string
      /** `{count}` is replaced. */
      days: string
      oneDay: string
      noDueDate: string
      confirm: string
    }
  }
  /** Announced after each action. */
  messages: {
    submitted: string
    replaced: string
    newVersion: string
    resubmitted: string
    coAuthorsAdded: string
    /** `{name}` is replaced. */
    coAuthorRemoved: string
    checkStarted: string
  }
}

/* ---------- Author: compliance checks ---------- */

export interface ComplianceContent {
  /** Label of each result (always shown as text on the badges). */
  results: Record<ComplianceResult, string>
  sampleBanner: string
  /** `{count}` and `{total}` are replaced. */
  summary: string
  /** Accessible name of the list of counts. */
  countsLabel: string
  /** `{name}` and `{version}` are replaced. */
  guideline: string
  details: { checked: string; version: string; guideline: string }
  card: {
    title: string
    /** `{version}` is the guideline version. */
    running: string
    /** Announced when a running check ends. */
    completed: string
    failed: string
    /** `{version}` is the SOP version. */
    none: string
    viewReport: string
    runAgain: string
    run: string
    /** The SOP's newest check used an older GVP version (PBI 29). `{checked}` and `{current}` are replaced. */
    recheck: { badge: string; note: string }
  }
  /** The compliance report page ("/my-sops/:id/compliance"), laid out as a formal report. */
  report: {
    /** `{code}` is replaced. */
    pageTitle: string
    /** Document title while printing (the default PDF file name); `{code}` and `{version}` are replaced. */
    printTitle: string
    /** `{code}` is replaced. */
    back: string
    title: string
    download: string
    /** Selector shown when reports exist for several versions; `{version}` is replaced. */
    versionSelect: { label: string; option: string; current: string }
    header: {
      /** Visually hidden heading of the report details. */
      title: string
      reportId: string
      sop: string
      version: string
      author: string
      coAuthors: string
      department: string
      checked: string
      guideline: string
      checkedBy: string
      checker: string
    }
    summary: {
      title: string
      /** `{score}` is replaced, e.g. "40%". */
      score: string
      scoreNote: string
      /** Text alternative of the score ring; `{score}`, `{count}` and `{total}` are replaced. */
      ringLabel: string
      /** Under the percentage in the ring. */
      ringCaption: string
      verdicts: Record<'fully-compliant' | 'needs-improvement' | 'action-required', string>
      /** One line under the verdict; `{count}` is replaced (one / several). */
      explanation: {
        actionRequired: { one: string; other: string }
        needsImprovement: { one: string; other: string }
      }
      /** Accessible name of the metric tiles. */
      tilesLabel: string
      priorities: {
        title: string
        /** `{number}`, `{result}`, `{requirement}` and `{title}` are replaced. */
        item: string
      }
      change: {
        title: string
        /** `{before}`, `{after}` and `{delta}` are replaced. */
        score: string
        /** `{before}`, `{after}` and `{kind}` are replaced. */
        verdict: string
        /** `{score}` is replaced. */
        percent: string
        /** `{points}` and `{version}` are replaced. */
        delta: { up: string; down: string; same: string }
        kinds: { improved: string; worsened: string; unchanged: string }
        /** Visually hidden text for the arrow. */
        changedTo: string
      }
      /** Parts of the summary sentence (one / several); `{count}` is replaced. */
      attention: Record<'conflict' | 'not-addressed' | 'partial', { one: string; other: string }>
      /** Joins the last two parts, e.g. "and". */
      and: string
      /** `{items}` is replaced; "one" when a single requirement needs attention. */
      beforeSubmit: { one: string; other: string }
      needsAttention: { one: string; other: string }
      allCompliant: string
    }
    overview: {
      title: string
      findingId: string
      requirement: string
      result: string
      /** `{id}`, `{section}` and `{title}` are replaced. */
      requirementLabel: string
    }
    findings: {
      title: string
      tabsLabel: string
      tabs: Record<'all' | ComplianceResult, string>
      needsAttention: string
      compliant: string
      /** Heading of each finding; `{number}` and `{requirement}` are replaced. */
      heading: string
      /** `{module}`, `{section}`, `{title}` and `{page}` are replaced. */
      requirementReference: string
      sopReference: string
      noSopReference: string
      justification: string
      recommendedAction: string
      /** No findings in the selected tab. */
      empty: string
    }
    changes: {
      title: string
      /** `{version}` and `{reportId}` are replaced. */
      comparedWith: string
      none: string
      /** Visually hidden text for the arrow. */
      changedTo: string
      kinds: Record<'resolved' | 'improved' | 'unchanged' | 'worsened' | 'new' | 'removed', string>
    }
    method: { title: string; items: string[] }
    /** A new check is running for the shown (current) version; `{version}` is replaced. */
    outOfDate: string
    /** The report used an older GVP version; `{checked}` and `{current}` are replaced. */
    olderGuideline: string
    /** The selected version has no completed report; `{version}` is replaced. */
    running: string
    failed: string
    none: string
  }
}

/* ---------- Development only: workflow demo controls ---------- */

/** Text for the demo panel (never part of the production build). */
export interface WorkflowDemoContent {
  title: string
  note: string
  noActions: string
  /** Per-person buttons; `{name}` is replaced. */
  buttons: {
    completeReview: string
    returnWithComment: string
    approve: string
    publish: string
    /** Shifts the stored due dates back, as if time had passed. */
    clockForward: string
  }
  /** Checkbox: the next compliance check started fails instead of completing. */
  failNextCheck: string
  commentDialog: {
    title: string
    /** `{name}` and `{role}` are replaced. */
    description: string
    label: string
    placeholder: string
    required: string
    confirm: string
    cancel: string
  }
  /** `{name}` is replaced where it appears. */
  messages: {
    reviewCompleted: string
    returned: string
    approved: string
    published: string
    clockForward: string
  }
}

/* ---------- Users (shared by the employee screens and the admin portal) ---------- */

export interface UsersContent {
  /** Name of each permission (badges, filters, checkboxes). */
  permissions: Record<Permission, string>
  /** Shown for a user without any permission (every user is an employee). */
  employee: string
  /** A deleted user's name on SOP history; `{name}` is replaced. */
  deletedName: string
}

/* ---------- Sign In: demo accounts (development only) ---------- */

export interface DemoAccountsContent {
  title: string
  note: string
  /** Accessible name of each "use" button; `{name}` is replaced. */
  useLabel: string
  use: string
}

/* ---------- Admin portal ---------- */

export interface AdminShellContent extends SidebarContent {
  portalLabel: string
  skipLink: string
  openMenu: string
  drawerLabel: string
  /** Shown under the admin's name in the top bar. */
  roleLabel: string
  /** Accessible text of the pending requests count in the sidebar; `{count}` is replaced. */
  pendingLabel: string
}

export interface AdminContent {
  shell: AdminShellContent
  /** Browser tab title of every admin page; `{page}` is replaced. */
  pageTitle: string
  usersList: AdminUsersListContent
  /** One line about each permission (Add user, user page). */
  permissionDescriptions: Record<Permission, string>
  addUser: AdminAddUserContent
  userDetails: AdminUserDetailsContent
  departmentsList: AdminDepartmentsListContent
  departmentForm: AdminDepartmentFormContent
  departmentDetails: AdminDepartmentDetailsContent
  requestsList: AdminRequestsListContent
  requestDetails: AdminRequestDetailsContent
  regulations: AdminRegulationsContent
  regulationForm: AdminRegulationFormContent
  regulationDetails: AdminRegulationDetailsContent
}

/** Labels shared by the regulations pages for a GVP version's details. */
export interface GuidelineVersionFields {
  issued: string
  effective: string
  file: string
  added: string
  requirements: string
  summary: string
}

export interface AdminRegulationsContent {
  title: string
  subtitle: string
  addVersion: LinkContent
  /** "GVP version {version}" */
  versionName: string
  /** Shown after adding a version; `{version}` is replaced. */
  added: string
  current: { title: string; badge: string }
  fields: GuidelineVersionFields
  /** `{name}` and `{date}` are replaced. */
  addedBy: string
  requirementsCount: CountText
  viewRequirements: string
  /** Accessible name of each "View requirements" link; `{version}` is replaced. */
  viewRequirementsLabel: string
  history: { title: string; empty: string }
}

export interface AdminRegulationFormContent {
  title: string
  subtitle: string
  back: LinkContent
  version: { label: string; hint: string }
  issuedDate: { label: string }
  effectiveDate: { label: string; hint: string }
  file: FileDropzoneText
  summary: { label: string; counter: string }
  submit: string
  cancel: string
  errors: {
    versionInvalid: string
    /** `{current}` is replaced with the current version. */
    versionNotHigher: string
    effectiveRequired: string
    issuedAfterEffective: string
    fileRequired: string
    fileNotPdf: string
    summaryTooLong: string
  }
  /** `{version}` is replaced. */
  dialog: { title: string; description: string; confirm: string; cancel: string }
}

export interface AdminRegulationDetailsContent {
  back: LinkContent
  details: { title: string }
  requirements: {
    title: string
    tableLabel: string
    columns: { id: string; module: string; section: string; title: string; page: string; summary: string }
    /** `{page}` is replaced. */
    page: string
  }
}

export interface AdminRequestDetailsContent {
  /** Browser tab title; `{title}` is replaced with the request's title. */
  pageTitle: string
  back: LinkContent
  requester: { title: string; name: string; email: string; homeDepartment: string; userPage: string }
  request: {
    title: string
    type: string
    requestTitle: string
    description: string
    department: string
    submitted: string
    status: string
  }
  /** `{admin}` and `{date}` are replaced. */
  decided: { approved: string; rejected: string }
  respond: { title: string; approve: string; reject: string }
  /** Why Approve or Reject can't be used. `{name}` and `{department}` are replaced. */
  reasons: {
    approved: string
    rejected: string
    cancelled: string
    departmentRemoved: string
    requesterDeleted: string
  }
  approveDialog: { title: string; access: string; change: string; confirm: string; cancel: string }
  /** `description` names the requester; `deletedDescription` is used when their account was deleted. */
  rejectDialog: { title: string; description: string; deletedDescription: string; confirm: string; cancel: string }
  approvedNotice: string
  rejectedNotice: string
  /** For permission and role change requests: points to the user page link in the Requester section. */
  changeHint: string
}

export type AdminRequestTabKey = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'

export interface AdminRequestsListContent {
  title: string
  subtitle: string
  tabsLabel: string
  tabs: Record<AdminRequestTabKey, string>
  search: { label: string; placeholder: string }
  count: CountText
  /** Accessible name of the table. */
  tableLabel: string
  columns: { requester: string; title: string; type: string; department: string; submitted: string; status: string }
  /** Shown instead of a department for requests that aren't about one. */
  noDepartment: string
  /** Visually hidden "Department requested:" before the department on phones. */
  departmentLabel: string
  empty: Record<AdminRequestTabKey, string>
  /** When a search finds nothing in the tab. */
  noMatches: string
}

export interface AdminDepartmentFormContent {
  add: { title: string; subtitle: string; submit: string }
  /** `{name}` is replaced with the department's current name. */
  edit: { title: string; subtitle: string; submit: string }
  /** Back to the list (Add) or to the department (Edit; `{name}` is replaced). */
  backToList: LinkContent
  backToDepartment: string
  name: { label: string }
  initials: { label: string; hint: string }
  description: { label: string; hint: string }
  cancel: string
  errors: {
    nameRequired: string
    nameTooLong: string
    nameTaken: string
    initialsInvalid: string
    initialsTaken: string
    descriptionTooLong: string
  }
}

export interface AdminDepartmentDetailsContent {
  back: LinkContent
  added: string
  updated: string
  /** A section title with its count, e.g. "Members (5)"; `{title}` and `{count}` are replaced. */
  titleWithCount: string
  details: { title: string; initials: string; description: string; noDescription: string }
  members: { title: string; empty: string }
  withAccess: { title: string; hint: string; empty: string }
  sops: { title: string; label: string }
  edit: string
  remove: {
    title: string
    text: string
    button: string
    /** `{name}` is replaced. */
    refused: string
    blockers: { members: CountText; sops: CountText; withAccess: CountText; pendingRequests: CountText }
    dialog: { title: string; description: string; confirm: string; cancel: string }
    /** Shown on the list afterwards; `{name}` is replaced. */
    done: string
  }
}

export interface AdminDepartmentsListContent {
  title: string
  subtitle: string
  addDepartment: LinkContent
  search: { label: string; placeholder: string }
  count: CountText
  /** Accessible name of the table. */
  tableLabel: string
  columns: { name: string; description: string; members: string; withAccess: string; sops: string }
  /** Card labels on phones: `{count}` is replaced. */
  cardCounts: { members: CountText; withAccess: CountText; sops: CountText }
  empty: string
}

export interface AdminAddUserContent {
  title: string
  subtitle: string
  back: LinkContent
  name: { label: string }
  email: { label: string; hint: string }
  department: { label: string; placeholder: string }
  permissions: { legend: string; hint: string }
  submit: string
  cancel: string
  errors: {
    nameRequired: string
    emailInvalid: string
    emailTaken: string
    departmentRequired: string
  }
}

export interface AdminUserDetailsContent {
  back: LinkContent
  /** Shown after adding a user. */
  added: string
  details: {
    title: string
    email: string
    homeDepartment: string
    joinedDepartments: string
    joinedHint: string
    none: string
  }
  permissions: {
    title: string
    /** Visually hidden legend of the checkboxes; `{name}` is replaced. */
    legend: string
    save: string
    saved: string
    /** Above the reasons when saving is refused. */
    refused: string
  }
  involvement: {
    title: string
    empty: string
    /** Accessible name of the list. */
    label: string
    roles: Record<'author' | 'co-author' | 'reviewer' | 'approver', string>
    /** Visually hidden before the roles. */
    rolesLabel: string
  }
  delete: {
    title: string
    text: string
    button: string
    /** `{name}` is replaced. */
    refused: string
    dialog: { title: string; description: string; confirm: string; cancel: string }
    /** Shown on the users list afterwards; `{name}` is replaced. */
    done: string
  }
  /**
   * Why a change is refused. `{name}` (the user) and `{sops}` (SOP codes; with their
   * status for reviewers and approvers) are replaced.
   */
  blockers: {
    selfDelete: string
    selfAdmin: string
    lastAdmin: string
    inUse: Record<'author' | 'reviewer' | 'approver', string>
    /** A permission that can't be removed; `{permission}` and `{reason}` are replaced. */
    cantRemove: string
    /** An SOP with its status, e.g. "SOP-081 (Returned)"; `{code}` and `{status}` are replaced. */
    sopWithStatus: string
  }
}

/** One or several, e.g. "1 user" / "9 users"; `{count}` is replaced. */
export interface CountText {
  one: string
  other: string
}

export interface AdminUsersListContent {
  title: string
  subtitle: string
  addUser: LinkContent
  search: { label: string; placeholder: string }
  departmentFilter: { label: string; all: string }
  permissionFilter: { label: string; all: string }
  count: CountText
  /** Accessible name of the table. */
  tableLabel: string
  columns: { name: string; email: string; department: string; permissions: string }
  empty: string
}
