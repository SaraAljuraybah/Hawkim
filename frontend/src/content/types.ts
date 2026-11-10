import type { FileDropzoneText } from '../components/ui/FileDropzone'
import type {
  ComplianceResult,
  DashboardStatKey,
  Permission,
  RequestType,
  SopFileType,
  TimelineEventType,
} from '../data/mock/types'
import type { SopDeleteErrorCode } from '../lib/mySops'
import type { OrganizationSort } from '../lib/organization'
import type { SopStatus } from '../types/status'

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
  | 'hierarchy'
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
  | 'reviews'

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
  subtitle: string
  user: { name: string; initials: string; department: string }
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
  /**
   * "Request Hawkim" (an on-premise product: organizations request it, there's no
   * public sign-up). Every Request Hawkim link opens this email (see lib/mailto.ts).
   */
  request: {
    label: string
    email: string
    subject: string
    body: string
  }
  nav: {
    ariaLabel: string
    /** Product name shown beside the logo mark in the header. */
    brandName: string
    /** Accessible name of the header logo link, e.g. "Hawkim, home". */
    homeLinkLabel: string
    links: NavLink[]
    signIn: CallToAction
    openMenu: string
    closeMenu: string
  }
  hero: {
    /** Rendered one per line inside the page's single <h1>. */
    headlineLines: string[]
    subtitle: string
    /** The primary call to action is Request Hawkim (see `request`). */
    secondaryCta: CallToAction
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
  }
  title: string
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
    invalidCredentials: string
    tooManyAttempts: string
    notConnected: string
    /** The account has no active profile (none was set up, or it was ended). */
    noAccess: string
    failed: string
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

/** The page behind "Forgot password?": passwords are reset by the project owner for now. */
export interface ProfileContent {
  /** Browser tab title. */
  pageTitle: string
  /** Browser tab title in the admin portal. */
  adminPageTitle: string
  title: string
  /** Row labels; `password` is the last row, with the Change Password action. */
  fields: { name: string; email: string; phone: string; position: string; division: string; department: string; roles: string; password: string }
  /** Shown when a value isn't set. */
  none: string
  roles: { author: string; reviewer: string; approver: string; admin: string }
  password: {
    /** Visible text of the action in the Password row. */
    change: string
    /** Its accessible name (contains the visible text). */
    changeLabel: string
    /** Shown on the page after changing it. */
    changed: string
    dialog: {
      title: string
      current: string
      next: string
      confirm: string
      /** `{min}` is replaced. */
      hint: string
      /** Accessible names of the eye button while the password is hidden / visible. */
      show: string
      hide: string
      cancel: string
      save: string
      /** The save button while saving. */
      saving: string
      /** Accessible name of the × button. */
      close: string
      /** `{min}` is replaced in tooShort. */
      errors: {
        currentRequired: string
        currentIncorrect: string
        nextRequired: string
        tooShort: string
        confirmRequired: string
        mismatch: string
        sameAsCurrent: string
        weak: string
        tooManyAttempts: string
        notConnected: string
        sessionEnded: string
        failed: string
      }
    }
  }
}

export interface ResetPasswordContent {
  /** Browser tab title. */
  pageTitle: string
  logoAlt: string
  title: string
  text: string
  passwordLabel: string
  /** `{min}` is the shortest password allowed. */
  passwordHint: string
  confirmLabel: string
  showPassword: string
  hidePassword: string
  save: string
  errors: {
    passwordRequired: string
    /** `{min}` is the shortest password allowed. */
    passwordTooShort: string
    confirmRequired: string
    mismatch: string
    weakPassword: string
    samePassword: string
    tooManyAttempts: string
    notConnected: string
    failed: string
  }
  /** The link is missing, invalid or expired. */
  invalid: { title: string; text: string; /** Goes to the person's own profile (see profilePathFor). */ action: { label: string } }
  saved: { title: string; text: string; dashboard: LinkContent; signIn: LinkContent }
}

export interface ForgotPasswordContent {
  /** Browser tab title. */
  pageTitle: string
  logoAlt: string
  title: string
  text: string
  emailLabel: string
  submit: string
  backLink: LinkContent
  errors: { emailRequired: string; emailInvalid: string; tooManyAttempts: string; notConnected: string; failed: string }
  /** Shown after the request; `{email}` is the address entered. Same text whether or not an account exists. */
  sent: { title: string; text: string }
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
  /**
   * Only shown to users with this permission (e.g. 'author'), or any of several
   * (e.g. reviewer or approver); everyone sees items without one.
   */
  permission?: Permission | Permission[]
}

/** The sidebar's content (employee app and admin portal). */
export interface SidebarContent {
  /** Product name shown as text next to the logo mark in the sidebar. */
  brandName: string
  homeHref: string
  /** Accessible name of the sidebar logo link. */
  homeLinkLabel: string
  navAriaLabel: string
  nav: AppNavItem[]
  signOut: AppNavItem
  closeMenu: string
  /** Accessible name of the signed-in user's role badges beside the product name. */
  rolesLabel: string
}

export interface AppShellContent extends SidebarContent {
  /** Visually hidden link that lets keyboard users jump past the navigation. */
  skipLink: string
  /** Accessible name of the sidebar logo link in a read-only department (it opens the SOP Directory). */
  homeLinkLabelReadOnly: string
  openMenu: string
  /** Accessible name of the mobile navigation drawer. */
  drawerLabel: string
  /** Accessible text of the My Reviews to-do count; `{count}` is replaced. */
  reviewsToDoLabel: string
  /** The avatar's link; `label` is its accessible name and `{name}` is the signed-in user. */
  profileLink: LinkContent
  /** Between the user's department and position under their name in the top bar; hidden from screen readers. */
  positionSeparator: string
  departmentSwitcher: {
    /** Label before the department name (visible in the drawer, screen-reader only in the top bar). */
    label: string
    /** Accessible name of the published-directory menu. */
    menuLabel: string
    readOnly: string
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
  /** Browser tab title in the admin portal. */
  adminPageTitle: string
  title: string
  /** Under the title, for everyone but the System Admin (their directory: SOPs they worked on). */
  subtitle: string
  /** Under the title, for the System Admin (every published SOP). */
  adminSubtitle: string
  /** Accessible name of the tab list. */
  tabsLabel: string
  tabs: Record<SopTabKey, string>
  filters: {
    label: string
    searchLabel: string
    searchPlaceholder: string
    sortLabel: string
    sortNewest: string
    sortOldest: string
    clear: string
    empty: string
    oneResult: string
    results: string
  }
  viewToggle: { label: string; grid: string; list: string }
  /** Column headings for the list view. */
  columns: { code: string; title: string; department: string; version: string; lastUpdated: string }
  /** `{version}` is replaced with the version number, e.g. "v3". */
  versionTemplate: string
  /** Shown when the list is empty. */
  empty: string
  /** The System Admin's empty directory (every department). */
  adminEmpty: string
  /** An empty Recently Published tab. */
  recentEmpty: string
  /** SOP detail page ("/sops/:id"). */
  detail: SopDetailContent
}

export interface SopDetailContent {
  fileFailed: string
  /** Under the title; `{division}`, `{department}` and `{date}` are replaced, " · " separates the parts. */
  subtitle: string
  /** The same for a department without a division. */
  subtitleNoDivision: string
  /** `{title}` is replaced, e.g. "Data Integrity | Hawkim". */
  pageTitle: string
  /** The same in the admin portal. */
  adminPageTitle: string
  back: LinkContent
  exportPdf: string
  descriptionTitle: string
  /** Accessible title of the embedded viewer; `{title}` is replaced. */
  viewerTitle: string
  /** Shown when the browser can't display PDFs inline (common on phones). */
  fallback: { text: string; openPdf: string; newTabHint: string }
  /** A Word file: shown in the browser; `viewerTitle` names the preview (`{title}` is replaced). */
  docx: { download: string; viewerTitle: string }
  /** Shown when a published SOP has no file available yet. */
  noFile: string
  /** `{department}` is replaced with the department name. */
  /** `adminText`: the same in the admin portal, where there is no Request Access. */
  /** An SOP the user may not open: `text` for everyone but the System Admin, `adminText` (`{department}`) for them. */
  noAccess: { title: string; text: string; adminText: string }
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
  /** Where Cancel goes in a read-only department (My Requests is hidden there). */
  readOnlyCancelHref: string
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

/** Author-facing internal review request form; backend-dependent limits remain explicit. */
export interface InternalReviewSubmitContent {
  title: string
  addIntro: string
  versionIntro: string
  department: string
  division: string
  /** The Division choice for departments without one. */
  noDivision: string
  /** The searchable Division and Department lists. */
  divisionPicker: { placeholder: string; toggle: string; noMatches: string }
  departmentPicker: { placeholder: string; toggle: string; noMatches: string }
  reviewers: string
  reviewerSearch: PeoplePickerContent
  reviewerRequired: string
  /** Shown under Reviewers while no department is chosen. */
  chooseDepartment: string
  /** `{department}` is the SOP's department. */
  homeFirst: string
  /** Shown under Division or Department when another one is chosen for the SOP's first review. */
  firstReviewHome: string
  firstSendHome: string
  mustFinish: string
  noneEligible: string
  duration: string
  durationHelp: string
  durationWorkingDays: string
  durationInvalid: string
  /** The estimated last day of the review; `{date}` is replaced. */
  durationDueDate: string
  /** `{count}` is replaced. */
  durationLong: string
  note: string
  noteServiceLimit: string
  confirm: string
  confirmLong: string
  cancel: string
}

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
  /** Accessible name of the chevron button that opens the list. */
  toggle: string
}

/* ---------- Author: My SOPs and Upload SOP ---------- */

export interface MySopsContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  /** `{department}` is replaced with the active department's name. */
  subtitle: string
  upload: LinkContent
  /** `{version}` is replaced, e.g. "v1". */
  versionTemplate: string
  /** Shown when a tab has no SOPs. */
  empty: string
  /** Announced after a successful upload. */
  uploadedMessage: string
  /** Label on SOPs the user co-authors. */
  coAuthorLabel: string
  mainAuthorLabel: string
  tabsLabel: string
  tabs: { new: string; progress: string; completed: string }
  viewToggle: { label: string; grid: string; list: string }
  filters: {
    label: string
    searchLabel: string
    searchPlaceholder: string
    /** Accessible name of the button that opens the list of SOP titles. */
    showTitles: string
    /** Shown in that list when no title matches the search. */
    noTitles: string
    sortLabel: string
    sortNewest: string
    sortOldest: string
    roleLabel: string
    allRoles: string
    clear: string
    oneResult: string
    results: string
    empty: string
  }
  /** On SOPs last checked against an older GVP version. */
  recheckLabel: string
  /** Deleting an SOP (main author, New SOPs and In Progress). */
  deleteSop: {
    /** Accessible name of the trash button: '{title}' is the SOP's title. */
    buttonLabel: string
    /** Dialog title: '{title}'. */
    title: string
    warning: string
    justificationLabel: string
    justificationRequired: string
    cancel: string
    confirm: string
    deleting: string
    /** Announced after a delete: '{title}'. */
    deleted: string
    /** Why the delete was refused, per refusal code. */
    errors: Record<SopDeleteErrorCode, string>
  }
}

export interface UploadSopContent {
  /** Browser tab title. */
  pageTitle: string
  title: string
  /** `{department}` is replaced with the active department's name. */
  subtitle: string
  fields: {
    title: { label: string; placeholder: string; hint: string; /** `{count}` and `{max}` are replaced. */ counter: string }
    department: { label: string }
    file: {
      label: string
      /** Read by screen readers only (a red asterisk is shown). */
      requiredTag: string
      hint: string
      dropPrompt: string
      browse: string
      remove: string
      typeError: string
      sizeError: string
    }
    description: { label: string; placeholder: string; /** `{count}` and `{max}` are replaced. */ counter: string }
  }
  errors: {
    titleRequired: string
    titleTooLong: string
    fileRequired: string
    /** The file couldn't be added or the SOP couldn't be saved. */
    saveFailed: string
  }
  cancel: LinkContent
  submit: { label: string; loadingLabel: string }
}

/* ---------- Author: SOP workflow page ---------- */

/** Text for a single-file picker (FileDropzone) used in workflow dialogs. */
export interface SopFileFieldContent {
  label: string
  /** Read by screen readers only (a red asterisk is shown). */
  requiredTag: string
  hint: string
  dropPrompt: string
  browse: string
  remove: string
  typeError: string
  sizeError: string
}

export interface SopWorkflowContent {
  /** `{title}` is replaced, e.g. "Data Integrity | Hawkim". */
  pageTitle: string
  back: LinkContent
  versionTemplate: string
  /** `{date}` is replaced. */
  lastUpdatedTemplate: string
  departmentLabel: string
  /** The SOP description under the header; the main author can edit it until the SOP is published. */
  description: {
    /** Accessible name and tooltip of the pencil button. */
    edit: string
    /** Label of the textarea while editing. */
    label: string
    /** `{count}` and `{max}` are replaced. */
    counter: string
    save: string
    cancel: string
    failed: string
  }
  roles: { reviewer: string; approver: string; author: string; coAuthor: string; system: string }
  reviewerDeadline: {
    due: string
    noDeadline: string
    assignedOneDay: string
    assignedDays: string
    assignedDuration: string
    remainingDuration: string
    lessThanSecond: string
    allocationUnknown: string
    remainingOneDay: string
    remainingDays: string
    dueToday: string
    overdue: string
    current: string
    active: string
    waiting: string
  }
  tracker: {
    label: string
    steps: { draft: string; 'in-review': string; 'in-approval': string; approved: string; published: string }
    returned: string
    /** Screen-reader state of each step. */
    srCompleted: string
    srCurrent: string
    srReturned: string
    /** Screen-reader state after each step's label in the coloured steps (the SOP page). */
    srStates: { completed: string; current: string; inProgress: string; returned: string; notReached: string }
    /** Under In Review / In Approval while open; `{date}` is replaced. */
    due: string
    overdue: string
    assignee: {
      title: string
      titlePlural: string
      reviewPending: string
      approvalPending: string
      revisionsPending: string
      publicationPending: string
      assignedOneDay: string
      assignedDays: string
    }
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
    /** The author's workflow page: the Authors section. */
    authorsTitle: string
    mainAuthor: string
    addAuthor: string
    /** Accessible name and tooltip of the Remove icon button; `{name}` is replaced. */
    removeLabel: string
    decisions: { pending: string; completed: string; approved: string; returned: string; cancelled: string }
  }
  file: {
    types: Record<SopFileType, string>
    /** Published SOPs: a link to the SOP in the directory (in SOP history). */
    viewInDirectory: string
  }
  /** SOP history: every version, with Preview, Download and Delete. */
  history: {
    title: string
    columns: { version: string; author: string; date: string; preview: string; download: string; delete: string }
    /** Marks the current version. */
    current: string
    /** Author of the versions the signed-in user uploaded. */
    you: string
    /** Accessible names and tooltips; `{version}` is replaced. */
    previewLabel: string
    downloadLabel: string
    deleteLabel: string
    /** Why Preview / Download aren't available: a Word file can't be previewed; the file isn't available (a sample, or no access). */
    unavailable: { demo: string }
    /**
     * Why Delete isn't available: by the SOP's status (only Draft and Returned allow it),
     * not the user's version (`{name}` is the main author), previously submitted, or the last version left.
     */
    deleteBlocked: {
      status: Record<Exclude<SopStatus, 'draft' | 'returned'>, string>
      'not-uploader': string
      'submitted-version': string
      'last-version': string
    }
    upload: string
    check: string
    /**
     * Why the compliance check isn't available: In Review or In Approval (it's hidden once
     * Approved or Published), or not the current version's uploader (`{name}` is the main author).
     */
    checkBlocked: { status: Record<'in-review' | 'in-approval', string>; 'not-uploader': string }
    /** Why the check isn't available once it has completed for this version and the current GVP version. */
    checkCompleted: string
    /** Preview dialog: `{title}` and `{version}` are replaced. */
    previewTitle: string
    /** Accessible name of the embedded viewer; `{title}` and `{version}` are replaced. */
    viewerTitle: string
    /** The same, for a Word file's preview. */
    docxViewerTitle: string
    close: string
    fallback: { text: string; openPdf: string; newTabHint: string }
  }
  /** Buttons on the Review timeline. */
  actions: {
    /** The button that opens Submit for review (Draft), or Resubmit for review once Returned. */
    submit: string
    resubmit: string
    response: string
    resubmitHint: string
    /** Shown to co-authors; `{name}` is the main author. */
    authorOnly: string
    /** Why Submit / Resubmit is disabled: the check is running, or there's no completed check. */
    checkWaiting: string
    checkNeeded: string
    /** The completed check used an older GVP version; `{version}` is the current one. */
    checkCurrentNeeded: string
  }
  comments: {
    title: string
    empty: string
    /** `{version}` is replaced. */
    versionHeading: string
  }
  timeline: {
    title: string
    columns: { action: string; by: string; to: string; date: string; version: string; comment: string }
    /** Screen-reader text of an empty cell. */
    none: string
    viewMore: string
    viewLess: string
    events: Record<TimelineEventType, string>
    /** review-deadline-changed: `{old}` and `{new}` are the dates, or noDeadline. */
    deadlineChange: string
    noDeadline: string
    /** Label for stage-due-date-set events, by stage. */
    stageDue: { review: string; approval: string }
    /** `{date}` is replaced. */
    due: string
    /** For co-author events; `{name}` is replaced. */
    subject: string
    /** For routed events: the new reviewer's department; `{name}` is replaced. */
    department: string
  }
  dialogs: {
    cancel: string
    fileField: SopFileFieldContent
    fileRequired: string
    /** The new version's file couldn't be uploaded or saved. */
    uploadFailed: string
    submit: {
      title: string
      /**
       * Optional review due date. `help` is always shown under it; once a date is picked,
       * the time given and the deadline: the end of that day (`{date}` is replaced in both; `{count}` in `days`).
       */
      reviewDate: { label: string; help: string; duration: string }
      /** `{count}` and `{max}` are replaced in the counter. */
      note: { label: string; placeholder: string; counter: string }
      /**
       * `dateInvalid`: `{min}` and `{max}` are the allowed dates. `submitFailed`: the store
       * refused the submission for a reason the dialog can't show (e.g. data changed meanwhile).
       */
      errors: { dateInvalid: string; submitFailed: string }
      confirm: string
    }
    /** `{version}` is the number the upload becomes. */
    newVersion: { title: string; description: string; confirm: string }
    /** `{version}` is replaced; `currentNote` (deleting the current version) also has `{previous}`. */
    deleteVersion: { title: string; description: string; currentNote: string; keep: string; confirm: string }
    addCoAuthors: {
      title: string
      description: string
      /** The search field's name, for screen readers only. */
      label: string
      required: string
      /** The co-authors couldn't be saved. */
      failed: string
      confirm: string
    }
    /** `{name}` is replaced in the description. */
    removeCoAuthor: { title: string; description: string; keep: string; confirm: string }
    /** `{names}` (the recipients) is replaced in the description; `{count}` and `{max}` in the counter. */
    /** `failed`: the response couldn't be saved. */
    response: { title: string; description: string; label: string; required: string; failed: string; unavailable: string; counter: string; confirm: string }
    /**
     * Resubmit for review. Its date and comments fields use the `submit` texts.
     * `failed`: the store refused the resubmission.
     */
    resubmit: {
      title: string
      failed: string
      confirm: string
    }
  }
  /** Announced after each action. */
  messages: {
    submitted: string
    newVersion: string
    /** `{version}` is replaced. */
    versionDeleted: string
    /** `{version}` is replaced. */
    deleteFailed: string
    /** A file couldn't be opened or downloaded. */
    fileFailed: string
    resubmitted: string
    coAuthorsAdded: string
    descriptionUpdated: string
    /** `{name}` is replaced. */
    coAuthorRemoved: string
    /** `{name}` is replaced. */
    coAuthorRemoveFailed: string
    checkStarted: string
    /** The check couldn't be started. */
    checkStartFailed: string
    /** The database refused the check: this version already has a completed one. */
    checkAlreadyCompleted: string
    responseSent: string
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
  /** An SOP version as shown, e.g. "v3"; `{version}` is replaced. */
  versionLabel: string
  guideline: string
  details: { checked: string; version: string }
  card: {
    title: string
    /** `{version}` is the guideline version. */
    running: string
    /** Announced when a running check ends. */
    completed: string
    failed: string
    /** The current version has no check yet; `{version}` is the SOP version. */
    notChecked: string
    viewReport: string
    /** The SOP's newest check used an older GVP version (PBI 29). `{checked}` and `{current}` are replaced. */
    recheck: { badge: string; note: string }
    /** The GVP version compliance checks use, in one row before the card's text (authors' view). */
    guideline: {
      /** Under its title; `{issued}` and `{added}` are the dates. */
      dates: string
    }
  }
  /** The authors' read-only page of that GVP version, from the card's View button. */
  guidelinePage: {
    /** `{name}` is the version's name (e.g. "GVP Version 4.0"), `{title}` the SOP's title. */
    pageTitle: string
    /** Back to the SOP; `{title}` is its title. */
    back: string
  }
  /** The compliance report page ("/my-sops/:id/compliance"), laid out as a formal report. */
  report: {
    /** `{title}` is replaced. */
    pageTitle: string
    /** Document title while printing (the default PDF file name); `{title}` and `{version}` are replaced. */
    printTitle: string
    /** `{title}` is replaced. */
    back: string
    title: string
    download: string
    /** Selector shown when reports exist for several versions; `{version}` is replaced. */
    versionSelect: { label: string; option: string; current: string }
    header: {
      /** Visually hidden heading of the report details. */
      title: string
      sop: string
      version: string
      author: string
      coAuthors: string
      department: string
      checked: string
      guideline: string
      checkedBy: string
      checker: string
      /** Who ran the check (the uploader, or who pressed Check). */
      runBy: string
    }
    summary: {
      title: string
      /** `{score}` is replaced, e.g. "40%". */
      score: string
      /** How the score is worked out, beside the ring. */
      scoreNote: string
      /** Text alternative of the score ring; `{score}`, `{count}` and `{total}` are replaced. */
      ringLabel: string
      /** Under the percentage in the ring. */
      ringCaption: string
      /** Shown on the review page next to the score (not in the report). */
      verdicts: Record<'fully-compliant' | 'needs-improvement' | 'action-required', string>
      /** Accessible name of the metric tiles. */
      tilesLabel: string
    }
    overview: {
      title: string
      /**
       * Under the title: how many SOP procedures were checked. `one` and `other` (`{count}` is
       * replaced) when the compliance service recorded it; `unknown` otherwise (sample results).
       */
      procedures: { one: string; other: string; unknown: string }
      findingId: string
      requirementTitle: string
      requirementReference: string
      result: string
      /** The reference under the title in the phone list; `{reference}` is replaced. */
      referenceLine: string
      /** A requirement with no title of its own. */
      none: string
    }
    findings: {
      title: string
      tabsLabel: string
      tabs: Record<'all' | ComplianceResult, string>
      needsAttention: string
      compliant: string
      /** Heading of each finding; `{number}` is replaced. */
      heading: string
      /** Labels of the requirement's Module, Section and Page lines (Section and Page also label the SOP Reference's lines). */
      module: string
      section: string
      page: string
      /** A missing Module, Section or Page. */
      none: string
      /** Heading above the requirement's Module, Section and Page lines. */
      requirementReference: string
      /** Heading above the requirement text. */
      requirement: string
      /** Heading above the SOP's Section and Page lines. */
      sopReference: string
      /** Between a section and its page when the SOP Reference has several sections. */
      lineSeparator: string
      /** The Section line of a step without a numbered SOP section. */
      noSectionNumberValue: string
      /** Label of a quote when the SOP Text has several; `{section}` is replaced (e.g. "5-4-1"). */
      stepSection: string
      /** The same for a step without a numbered SOP section. */
      noSectionNumber: string
      noSopReference: string
      /** Heading above the SOP sentences the result is based on. */
      sopText: string
      justification: string
      /** No findings in the selected tab. */
      empty: string
    }
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
  /** A deleted user's name on SOP history; `{name}` is replaced. */
  deletedName: string
}

/* ---------- Loading state (while a page's code loads) ---------- */

export interface LoadingContent {
  label: string
}

/* ---------- App-wide screens (connection to the backend) ---------- */

export interface SystemContent {
  logoAlt: string
  /** frontend/.env.local is missing, incomplete, or uses the secret key. */
  notConfigured: {
    pageTitle: string
    title: string
    missing: string
    /** The URL has a path (e.g. /rest/v1/) or isn't a valid address. */
    urlFormat: string
    secretKey: string
  }
  /** The people or departments couldn't be loaded after sign-in. */
  loadFailed: {
    pageTitle: string
    title: string
    text: string
    retry: string
  }
}

/* ---------- Notifications (bell in the employee top bar) ---------- */

export interface NotificationsContent {
  bellLabel: string
  /** `{count}` is replaced. */
  bellLabelUnread: string
  title: string
  markAllRead: string
  empty: string
  /** Visually hidden next to the unread dot. */
  unread: string
  /** Relative time under a minute. */
  justNow: string
  /** `{name}`, `{title}`, `{version}`, `{day}`, `{reason}` and `{department}` are replaced. */
  texts: {
    submitted: string
    resubmitted: string
    routed: string
    handoff: string
    resent: string
    internalReviewCompleted: string
    /** Internal review requests ({name}: the reviewer, or the author for a removal). */
    reviewDeclined: string
    reviewWithdrawn: { author: string; reviewer: string }
    reviewExpired: { author: string; reviewer: string }
    reviewerRemoved: string
    /** To a reviewer who can no longer read the SOP, so no name is shown. */
    reviewerRemovedClosed: string
    reviewCompleted: string
    reviewReturned: string
    reviewOverdue: string
    assignedApproval: string
    readyToPublish: string
    returned: string
    approved: string
    published: string
    response: string
    /** `{date}` is the new deadline. */
    reviewDeadlineChanged: string
    /** `response`: a reviewer's reminder to accept or decline before the request expires. */
    dueSoon: { review: string; response: string; approval: string }
    days: { today: string; tomorrow: string }
    overdue: { review: string; approval: string }
    accessRequest: { approved: string; rejected: string }
    request: { approved: string; rejected: string }
  }
}

/* ---------- Reviews (reviewer and approver) ---------- */

export type ReviewTabKey = 'todo' | 'waiting' | 'done'

export interface ReviewsContent {
  list: {
    pageTitle: string
    title: string
    subtitle: string
    tabsLabel: string
    tabs: Record<ReviewTabKey, string>
    empty: Record<ReviewTabKey, string>
    reviewerTabs: { incoming: string; active: string; completed: string }
    reviewerEmpty: { incoming: string; active: string; completed: string }
    approvalsTitle: string
    approvalsDescription: string
    approvalTabsLabel: string
    approvalListLabel: string
    reviewerListLabel: string
    waiting: string
    closed: string
    decisions: Record<string, string>
    version: string
    updated: string
    view: { label: string; grid: string; list: string }
    /** Accessible name of the list. */
    listLabel: string
    /** `{name}` is replaced. */
    author: string
    /** `{role}` is replaced. */
    yourRole: string
    roles: { reviewer: string; approver: string }
    needs: { review: string; approval: string; publish: string }
    /** `{date}` is replaced. */
    due: string
    noDueDate: string
    overdue: string
  }
  page: ReviewPageContent
}

/** A dialog with an optional or required comment. */
export interface ReviewCommentDialog {
  title: string
  description: string
  label: string
  confirm: string
}

export interface ReviewPageContent {
  fileFailed: string
  /** `{title}` is replaced. */
  pageTitle: string
  back: LinkContent
  /** `{name}` / `{names}` are replaced. */
  author: string
  coAuthors: string
  /** `{date}` is replaced. */
  due: string
  overdue: string
  file: {
    title: string
    download: string
    /** `{title}` is replaced. */
    viewerTitle: string
    /** The same, for a Word file's preview. */
    docxViewerTitle: string
    fallback: { text: string; openPdf: string; newTabHint: string }
  }
  compliance: {
    title: string
    none: string
    running: string
    /** Accessible name of the score; `{score}` is replaced. */
    score: string
    viewReport: string
  }
  actions: {
    title: string
    completeReview: string
    returnToAuthor: string
    route: string
    approve: string
    publish: string
  }
  /** When there's nothing for the user to do now. `{date}`, `{names}` are replaced. */
  status: {
    reviewCompleted: string
    historical: string
    approved: string
    waitingFor: string
    waitingForReviews: string
    returned: string
    published: string
  }
  dialogs: {
    cancel: string
    /** `{count}` and `{max}` are replaced. */
    counter: string
    complete: ReviewCommentDialog
    approve: ReviewCommentDialog
    return: ReviewCommentDialog & { required: string }
    route: {
      title: string
      description: string
      pickerLabel: string
      /** `{department}` is replaced with the SOP's department. */
      pickerHint: string
      required: string
      noneEligible: string
      noteLabel: string
      confirm: string
    }
    /** `{title}` and `{department}` are replaced. */
    publish: { title: string; description: string; confirm: string }
  }
  /** Shown after each action. `{name}` and `{department}` are replaced. */
  messages: {
    completed: string
    returned: string
    routed: string
    approved: string
    published: string
  }
}

/* ---------- Admin portal ---------- */

export interface AdminShellContent extends SidebarContent {
  skipLink: string
  openMenu: string
  drawerLabel: string
  /** The admin's name and avatar in the top bar; `{name}` is replaced in the label. */
  profileLink: LinkContent
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
  /** One line about each permission (Add User, Edit User). */
  permissionDescriptions: Record<Permission, string>
  addUser: AdminAddUserContent
  editUser: AdminEditUserContent
  userDetails: AdminUserDetailsContent
  deleteUser: AdminDeleteUserContent
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
/** The details of a GVP version, in this order. */
export interface GuidelineVersionFields {
  title: string
  version: string
  issued: string
  added: string
  addedBy: string
  source: string
  file: string
  requirements: string
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
  /** An added version's processing status, shown next to its version number in the list. */
  processingStatus: { waiting: string; processing: string; ready: string; failed: string }
  fields: GuidelineVersionFields
  /** An empty value. */
  none: string
  /** "Added By" for a version with no recorded uploader (a temporary placeholder; see admin.en.ts). */
  addedByFallback: string
  /** Read by screen readers after the Source link. */
  newTab: string
  requirementsCount: CountText
  /** The versions admins added couldn't be loaded (the published ones are still listed). */
  addedLoadFailed: { text: string; retry: string }
  /** Every version, newest first; `columns.actions` is a visually hidden header. */
  history: {
    title: string
    tableLabel: string
    columns: { title: string; version: string; issued: string; added: string; actions: string }
  }
  /** `{title}` and `{version}` are replaced; the result is `{name}` below. */
  versionLabel: string
  /** Accessible names and tooltips of each row's icon buttons. */
  actions: { view: string; edit: string; delete: string }
  /** Why Delete is disabled (its tooltip, and read after its name): the current version, or one that was current before. */
  deleteBlocked: { current: string; used: string }
  updated: string
  deleted: string
  /** `permission` and `failed`: why deleting didn't work, shown in the dialog. */
  deleteDialog: { title: string; description: string; cancel: string; confirm: string; permission: string; failed: string }
}

export interface AdminRegulationFormContent {
  title: string
  /** Editing a version: its heading (no subtitle) and button. */
  editTitle: string
  save: string
  subtitle: string
  back: LinkContent
  /** The Title field (`title` is the page's heading). */
  titleField: { label: string }
  version: { label: string; hint: string }
  issuedDate: { label: string }
  /** Read-only: today in Asia/Riyadh. */
  addedDate: { label: string }
  file: FileDropzoneText
  /** Editing a published version with no PDF: the File field's hint (the PDF is optional there). */
  attachHint: string
  source: { label: string; placeholder: string }
  submit: string
  cancel: string
  errors: {
    titleRequired: string
    titleTooLong: string
    versionInvalid: string
    /** `{version}` is replaced. */
    versionExists: string
    /** `{current}` is replaced with the current version. */
    versionNotHigher: string
    addedRequired: string
    issuedRequired: string
    issuedAfterAdded: string
    fileRequired: string
    fileNotPdf: string
    sourceRequired: string
    sourceInvalid: string
    /** Not a link from sfda.gov.sa. */
    sourceNotSfda: string
    sourceTooLong: string
    fileExists: string
    uploadFailed: string
    /** Saving was refused: not an admin (any more). */
    permission: string
    /** Anything else, e.g. no connection. */
    failed: string
  }
  /** `{version}` is replaced. */
  dialog: { title: string; description: string; confirm: string; cancel: string }
}

export interface AdminRegulationDetailsContent {
  back: LinkContent
  details: { title: string }
  /** The File card: `{fileName}` is replaced; `unavailable` when the version has no PDF, `openFailed` when its link couldn't be made. */
  file: {
    title: string
    unavailable: string
    openFailed: string
    viewerTitle: string
    fallback: { text: string; openPdf: string; newTabHint: string }
  }
  requirements: {
    title: string
    tableLabel: string
    columns: { id: string; module: string; section: string; title: string; page: string; summary: string }
    /** `{page}` is replaced. */
    page: string
  }
  /** The processing card of an added version (GVP phase 2). */
  processing: {
    title: string
    status: { waiting: string; processing: string; ready: string; failed: string }
    /** Shown while the version is waiting or being processed. */
    keepWorking: string
    /** `{done}`, `{total}` and `{percent}` are replaced in `embedding`; `label` names the progress bar. */
    progress: { reading: string; embedding: string; saving: string; label: string }
    /** `{requirements}` and `{sections}` are replaced. */
    report: string
    /** `{pages}` is replaced. */
    pages: string
    warningsTitle: string
    /** `{sections}`: the excluded section codes this version doesn't have. */
    missingExcluded: string
    retry: string
    makeCurrent: string
    /** `{version}` is replaced. */
    confirm: string
    confirmAction: string
    cancel: string
    madeCurrent: string
    failedAction: string
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
  /** `hint`: the Add/Edit Department page only. `counter`: the dialog; `{count}` and `{max}` are replaced. */
  description: { label: string; hint: string; counter: string }
  /** Optional. */
  email: { label: string; placeholder: string }
  cancel: string
  /** The primary button of the Add and Edit Department dialogs on Divisions & Departments. */
  dialogSubmit: { add: string; edit: string }
  errors: {
    nameRequired: string
    nameTooLong: string
    nameTaken: string
    descriptionTooLong: string
    emailInvalid: string
  }
}

export interface AdminDepartmentDetailsContent {
  back: LinkContent
  added: string
  updated: string
  /** A section title with its count, e.g. "Users (5)"; `{title}` and `{count}` are replaced. */
  titleWithCount: string
  details: { title: string; description: string; noDescription: string }
  users: { title: string; empty: string }
  edit: string
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
  email: { label: string }
  phone: { label: string; hint: string }
  /** Searchable list of divisions; `noDivision` is the choice for departments without one. */
  division: { label: string; placeholder: string; noDivision: string; toggle: string; noMatches: string }
  /** Searchable list of the chosen division's departments. */
  department: { label: string; placeholder: string; selectDivisionFirst: string; toggle: string; noMatches: string }
  position: { label: string }
  permissions: { legend: string }
  submit: string
  /** The submit button while adding. */
  adding: string
  cancel: string
  /** Above the reason when the server refused. */
  notAdded: string
  failures: Record<'forbidden' | 'email-taken' | 'invalid' | 'admin-exclusive' | 'approver-quality' | 'department-unavailable' | 'account-failed' | 'account-blocked' | 'failed', string>
  errors: {
    nameRequired: string
    emailInvalid: string
    emailTaken: string
    phoneRequired: string
    phoneInvalid: string
    divisionRequired: string
    departmentRequired: string
    positionRequired: string
    /** `{max}` is replaced. */
    positionTooLong: string
    approverOutsideQuality: string
  }
}

/** Edit User: its fields, Cancel and the back link are Add User's. */
export interface AdminEditUserContent {
  title: string
  submit: string
  /** The submit button while saving. */
  saving: string
  /** Shown after saving, when everything changed is in the database. */
  saved: string
  /** Above the reasons when the permission rules refuse saving. */
  refused: string
  /** Above the reason when the database couldn't save. */
  notSaved: string
  failures: Record<'forbidden' | 'not-found' | 'conflict' | 'invalid' | 'self-admin' | 'last-admin' | 'admin-exclusive' | 'approver-quality' | 'department-unavailable' | 'department-required' | 'failed', string>
  /** A permission still in use, with the number of SOPs; `{permission}` and `{count}` are replaced. */
  inUse: { one: string; other: string }
  /** The other changes were saved, but the email wasn't: above the reason. */
  emailNotSaved: string
  emailFailures: Record<'forbidden' | 'not-found' | 'email-taken' | 'invalid' | 'account-failed' | 'failed', string>
  /** A department change refused while SOP work is in progress; `{count}` is the number of SOPs. */
  transfer: { title: string; message: string; count: CountText }
  /** Asked before leaving the form with unsaved changes. */
  discard: { title: string; description: string; keep: string; discard: string }
}

export interface AdminUserDetailsContent {
  back: LinkContent
  /** Opens Edit Staff. */
  edit: string
  /** Shown after adding a user. */
  added: string
  /** Shown after adding a user whose invitation email couldn't be sent. */
  addedInvitationFailed: string
  /** The rows, in this order; `notSet` for an empty value. */
  details: {
    title: string
    name: string
    email: string
    phone: string
    division: string
    department: string
    position: string
    permission: string
    notSet: string
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
    /** An SOP with its status, e.g. "Data Integrity (Returned)"; `{title}` and `{status}` are replaced. */
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
  addUser: LinkContent
  search: { label: string; placeholder: string }
  /** Clears the search and both filters (their texts are organizationAdminEn's, shared with the other pages). */
  clearFilters: string
  count: CountText
  /** Accessible name of the table. */
  tableLabel: string
  columns: { name: string; division: string; department: string; permissions: string; actions: string }
  /** An empty cell (e.g. no division). */
  none: string
  /** Accessible names and tooltips of the row's icon buttons; `{name}` is replaced. */
  actions: { view: string; edit: string }
  empty: string
}

/** Delete User, on the Users list and a user's page; `{name}` is replaced. */
export interface AdminDeleteUserContent {
  button: string
  title: string
  description: string
  cancel: string
  confirm: string
  refused: string
  done: string
}

/** The public Request Hawkim form (pages/RequestHawkimPage.tsx). */
export interface RequestHawkimContent {
  pageTitle: string
  logoAlt: string
  title: string
  text: string
  fields: {
    organization: string
    contactName: string
    jobTitle: string
    email: string
    phone: string
    phoneHint: string
    approxUsers: string
    /** Labelled "(Optional)", like the optional fields of the other forms. */
    message: string
    messagePlaceholder: string
    /** `{count}` and `{max}` are replaced. */
    messageCounter: string
  }
  submit: string
  backLink: LinkContent
  errors: {
    required: string
    email: string
    phone: string
    approxUsers: string
    tooLong: string
    tooManyRequests: string
    notConnected: string
    failed: string
  }
  /** `{name}` and `{email}` are the contact person and the address entered. */
  sent: { title: string; text: string; action: LinkContent }
}

/** The Hawkim team's review page for a request (pages/ReviewRequestPage.tsx). */
export interface ReviewRequestContent {
  pageTitle: string
  logoAlt: string
  loading: string
  title: string
  text: string
  labels: { organization: string; contactName: string; jobTitle: string; email: string; phone: string; approxUsers: string; message: string; received: string }
  noMessage: string
  accountExists: string
  accept: string
  reject: string
  /** Shown when the link is wrong, expired or already used. */
  notFound: { title: string; text: string }
  expired: { title: string; text: string }
  decided: { accepted: { title: string; text: string }; rejected: { title: string; text: string } }
  /** Someone else decided while this page was open. */
  alreadyDecided: { title: string; text: string }
  /** After the team's decision. `{email}` is the requester's address. */
  accepted: { title: string; text: string; emailFailed: string }
  rejected: { title: string; text: string }
  errors: { emailInUse: string; accountFailed: string; notConnected: string; failed: string }
}

/** The page controls under a long list. `{page}` is the page number. */
export interface PaginationContent {
  /** The accessible name of the controls (a nav landmark). */
  label: string
  previous: string
  next: string
  /** Accessible names of Previous and Next (they show only an arrow on small screens). */
  previousPage: string
  nextPage: string
  page: string
}

/** DEVELOPMENT ONLY: the sample SOPs for trying pagination. `{n}` is the sample number. */
export interface DevSamplesContent {
  title: string
}

/* ---------- Organizational Structure (every signed-in user; "Staff" wording on this page only) ---------- */

export interface OrganizationContent {
  pageTitle: string
  title: string
  /** The short description under the heading. */
  subtitle: string
  retry: string
  loading: string
  error: string
  /** No divisions or departments at all. */
  empty: string
  /** Nothing matches the search and filters. */
  noMatches: string
  name: string
  email: string
  /** Read by screen readers instead of the "—" shown when there is no email. */
  noEmail: string
  /** "Departments (n)" under a division's name. */
  departmentCount: (count: number) => string
  /** "Staff (n)" under a department's name. */
  staffCount: (count: number) => string
  noStaff: string
  noDepartments: string
  /** The group of departments without a division. */
  unassigned: string
  /** Screen-reader prefix of a person's roles. */
  rolesLabel: string
  /** The copy button's accessible name, e.g. "Copy email for Dana Fahad". */
  copyEmail: (name: string) => string
  copied: string
  copyFailed: string
  search: string
  searchPlaceholder: string
  filter: string
  /** The Filter button's accessible name while filters are on. */
  filterActive: (count: number) => string
  filtersTitle: string
  clearAll: string
  divisionFilter: string
  divisionFilterEmpty: string
  departmentFilter: string
  departmentFilterEmpty: string
  roleFilter: string
  /** The Role filter's chip for staff without a role. */
  others: string
  sort: string
  sortOptions: Record<OrganizationSort, string>
}
