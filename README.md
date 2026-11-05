# Hawkim | حَوكِم

### AI-Assisted SOP Workflow Management and Regulatory Compliance Platform

Hawkim is a web-based platform designed for pharmaceutical organizations regulated by the Saudi Food and Drug Authority (SFDA). It provides a centralized environment for managing Standard Operating Procedures (SOPs), supporting structured review and approval workflows, maintaining traceability, and assisting with regulatory compliance verification.

> **Graduation Project — King Saud University | Information Technology**

---

## About Hawkim

Standard Operating Procedures (SOPs) are essential for maintaining consistent and controlled processes within pharmaceutical organizations. Managing these procedures often involves multiple stakeholders, several review and approval stages, document revisions, and continuous alignment with regulatory requirements.

Hawkim brings these activities into a centralized environment by combining **SOP workflow management and governance** with **AI-assisted regulatory compliance verification**.

The platform aims to improve transparency throughout the SOP lifecycle, maintain traceability of actions and revisions, and assist users in identifying potential regulatory compliance gaps during the process.

---

## Key Features

### SOP Management
Centralized management of SOP documents throughout their lifecycle.

### Review & Approval Workflow
A structured workflow that supports SOP creation, review, revision, and approval across different organizational roles.

### Role-Based Collaboration
Supports the responsibilities and interactions of Authors, Reviewers, and Approvers throughout the SOP workflow.

### Version & Activity Tracking
Maintains traceability of SOP revisions, comments, decisions, and workflow activities.

### AI-Assisted Compliance Verification
Analyzes SOP content against relevant regulatory requirements to support compliance verification.

### Compliance Findings
Identifies potential compliance gaps and provides relevant regulatory evidence to support users during SOP review.

---

## Regulatory Scope

Hawkim is designed for pharmaceutical organizations regulated by the **Saudi Food and Drug Authority (SFDA)**.

The current compliance verification scope focuses on the **SFDA Guideline on Good Pharmacovigilance Practices (GVP)**.

The scope may be expanded to additional regulatory guidelines in future development.

---

## User Roles

Hawkim supports three primary roles involved in the SOP lifecycle:

### Author
Responsible for creating and updating SOPs and addressing requested changes throughout the review process.

### Reviewer
Responsible for reviewing SOP content, providing feedback, and coordinating required revisions before the SOP proceeds through the approval process.

### Approver
Responsible for evaluating SOPs during the approval stage and making approval decisions according to the defined workflow.

### Admin
Handles user requests, such as access to other departments. The Admin role is not part of the SOP review and approval workflow.

---

## SOP Workflow

Hawkim supports a structured SOP lifecycle involving multiple review and approval stages.

```text
Draft ? In Review ? In Approval ? Approved ? Published
           ?             ?
           ??? Returned ??
                 ?
                 ?
          Author revises and resubmits ? In Review
```

New SOP submissions use internal parallel review. Each SOP version is one review round, and each reviewer has their own review request in it:

1. The main Author sends review requests for the current version, after a current compliance check, to eligible reviewers from the SOP's home department: the first send of every version goes to that department only. Authors and co-authors cannot review their own SOP. Each request gets a fixed response deadline, set by the server, and can have an optional review duration (1 to 3,650 working days, confirmed above 60); see below.
2. A reviewer must respond first: **Accept** (the review duration starts) or **Decline** with a required reason.
3. After accepting, the reviewer either **Returns to author** (comments required) or **Completes the review** (optional comments). A return affects only that reviewer; the SOP stays In Review.
4. A request still pending when its response deadline has ended **expires**. This is the only automatic action (the rule is `expiryDueAt` in `src/lib/internalReviewStatus.ts`; the database applies it when anyone who can see the SOP loads it or acts on it, so no scheduled job is needed). An expired request is locked: the reviewer can no longer accept or decline it, and they count as not taking part, so the round can complete without them. The main Author decides what happens next: remove the reviewer, add a different one, or **send the request again** to the same reviewer, which creates a new request with a new response deadline and reopens a completed round. A passed review duration only marks the request Overdue.
5. The main Author can **remove a reviewer** at any time, whatever their status, with a required reason, and can **add reviewers** for the same version while the review is open or after it settled (which reopens it). Once a reviewer from the SOP's department has finished the current version (completed or returned), they can add reviewers from **any department**; until then, only from the SOP's department. The Quality Document Controller of the SOP's department isn't offered. Declined and removed reviewers can be asked again; an expired request is sent again instead; after a return, a new version is needed.
6. Once every reviewer taking part has finished the current version (returned or completed it), or nobody is taking part, the Author can upload, check and send a **new version** to the reviewers they choose, as a new round. A version never sent to a reviewer can be deleted while In Review.
7. **Submit for approval** is available as soon as at least one reviewer has completed the review of the current version, unless the SOP was already sent; until then it stays visible and says why. Reviewer requests still open stay open. Approval isn't in the database yet, so this browser remembers the version it sent and keeps the button disabled after a reload, until the approver returns it or a new version is uploaded.

**Deadlines follow Riyadh working days.** All dates use Asia/Riyadh, and working days are Sunday to Thursday (Friday and Saturday never count). The response deadline is fixed: the end of the second working day after sending, with the sending date not counted (sent Thursday = due Monday, 11:59 PM). The server sets it, so the author doesn't choose it. The optional review duration is up to 3,650 working days (a technical limit) after that reviewer's acceptance, with the acceptance date not counted (accepted Thursday + 5 working days = due the next Thursday, 11:59 PM). Every deadline ends at 23:59:59.999 Riyadh time. The app always shows the deadlines the database saved; it never recalculates them, and requests sent before this policy keep theirs, including a calendar-day review duration. Public holidays are not covered: a holiday from Sunday to Thursday counts as a working day.

The main Author can change an accepted reviewer's deadline, or set one, as often as needed: they enter working days counted from the acceptance date, and the dialog shows the resulting date. It can't be in the past or the same as now, and an earlier deadline or more than 60 working days must be confirmed. Each change is saved in the timeline, readable only by the author, co-authors and that reviewer, and the reviewer is notified. A passed deadline only marks the request Overdue; the reviewer can still finish.

The switch is `WORKING_DAY_DEADLINES_ACTIVE` in `src/lib/deadlinePolicy.ts` (currently `true`). The app needs the migrations `20261101120000` and `20261101120100` to be applied first; see `supabase/proposals/REVIEW_NOTES.md`.

Reviewers get 24-hour reminders to respond and to finish. The main Author is notified of declines, returns, each completed review, the phase being done, expired requests and overdue reviews; co-authors of declines and returns; reviewers of removals, expired requests and requests sent again. An expired request stays unread until someone acts on it.

Shared workflow contract: `Sop.internalReviewRounds` stores one round per version. Each request (assignment) has its own ID; a reviewer's latest request in a round is the one that counts, and earlier ones stay in the history. The round status is recalculated after every change: open (someone taking part hasn't finished, or nobody is taking part), completed, or changes-requested. `Sop.reviewers` projects each reviewer's latest request for existing views. A completed round on the current version is the boundary for approval (`ApprovalSubmission.internalReviewRoundId`) and for the external-routing teammate (`ExternalReviewGate.internalReviewRoundId`); it does not represent approval. Reviewer-facing document and compliance views expose only versions sent to that reviewer; historical links cannot reveal a later unassigned version. Removing a reviewer never changes their global Reviewer permission or another SOP's requests; declined, expired, withdrawn and removed requests do not block user administration.

Existing (sample) SOPs without internal rounds keep their legacy sequential review and approval behavior. Reviewers can repeat a saved handoff to an already assigned eligible reviewer with the original deadline. New reviewer assignments remain Author-controlled; the older sequential cross-department routing stays for those sample SOPs only. No in-flight record is silently migrated. Department workflow configuration and all SOP changes remain in memory and reset on reload. Submitted versions remain protected from deletion.

**Reviewers from other departments** read only the versions sent to them. If their latest request on an SOP is declined, removed or expired, they lose the SOP completely, including after it's published, until they are asked again; their notifications still reach them through their own closed requests (title, version, status and reason only). "Same department" always means the reviewer's current department. Other departments' access to published SOPs comes later, through department access requests.

The workflow maintains the history of actions, feedback, revisions, and decisions to provide clear traceability throughout the SOP lifecycle.

---

## AI-Assisted Compliance Verification

Hawkim includes an AI-assisted component designed to support the regulatory verification of SOP content.

The compliance verification process aims to:

- Identify regulatory requirements relevant to the SOP.
- Compare SOP content against applicable requirements.
- Detect potential missing or conflicting information.
- Provide supporting regulatory evidence.
- Assist users in reviewing potential compliance findings.

The AI component is intended to **support human decision-making**, while final regulatory and approval decisions remain with authorized users.

---

## Project Management & Development

The project uses collaborative tools to organize development activities and maintain project progress.

### Jira

Jira is used for project management activities, including:

- Requirements and task management
- Sprint planning
- Task assignment
- Progress tracking
- Development backlog

### GitHub

GitHub is used for source code management and collaborative development, including:

- Version control
- Branch management
- Pull requests
- Code review
- Development history

---

## Git Workflow

The repository follows a two-branch workflow.

### Branches

- `develop` — Default branch for ongoing development. All work is committed and pushed directly to `develop`.
- `main` — Stable version of the project only. It is updated through a pull request from `develop`.

### Development Flow

```text
develop → main
```

Changes are committed in small, logical commits on `develop`. When a stable version is ready, `develop` is merged into `main` through a pull request.

---

## Frontend

The web frontend lives in the [`frontend/`](frontend/) folder and is built with **React**, **Vite**, **TypeScript** and **Tailwind CSS**.

### Requirements

- Node.js 20.19+ or 22.12+ (includes npm)

### Run locally

1. Copy `frontend/.env.example` to `frontend/.env.local` and fill in the Supabase project URL
   and **publishable** key (Supabase dashboard → Project Settings → Data API and API Keys).
   Never use the secret (service_role) key. Without this file the app shows a "not configured" screen.
2. Install and start:

```bash
cd frontend
npm install
npm run dev
```

Then open the local URL printed in the terminal (usually http://localhost:5173).

To sign in, use one of the test accounts in [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md). Ask the project owner for the test password.

Sign-in, people, departments, guideline versions, SOPs, files, co-authors, compliance checks and internal review are saved in Supabase. The compliance check applies only to Pharmacovigilance SOPs. Division and department management is also persisted through administrator-only database functions; see [setup, retention rules and verification](docs/divisions-departments.md). Approval, user administration and access requests for other departments remain in this browser tab and reset on reload.

### Other commands

```bash
npm run build     # type-check and create a production build in frontend/dist
npm run preview   # serve the production build locally
npm run lint      # lint the source code
```

### Testing

The rules in `frontend/src/lib/` (SOP workflow, compliance reports, SOP access and user administration) are covered by unit tests written with [Vitest](https://vitest.dev/). Each test file sits next to the module it tests, e.g. `src/lib/workflow.test.ts`.

```bash
npm test             # run all tests once
npm run test:watch   # re-run the tests when files change
```

Regenerating the sample SOP PDFs (`npm run generate:sample-sops`) requires Node 22.18+; the generated files are already committed.

Landing page text is kept in `frontend/src/content/landing.en.ts`, and the brand design tokens (colours and fonts) are defined in `frontend/src/index.css`.

---

## Repository Structure

The repository structure will be documented as the system architecture and implementation are finalized.

---

## Project Status

> 🚧 **Currently Under Development**

Hawkim is being developed as a graduation project at King Saud University. Features, architecture, and implementation details may evolve throughout the development lifecycle.

---

## Team

**King Saud University**  
College of Computer and Information Sciences  
Department of Information Technology

**Graduation Project — Group 11**

### Project Team

- Sara Aljuraybah
- Dana Alosaimi 
- Haya Alomar
- Dalal Alghumlas 

### Supervisor

**Dr. Ebtisam Alabdulqader**

---

## Disclaimer

Hawkim is an academic graduation project developed for research and educational purposes.

The AI-assisted compliance verification functionality is designed to support regulatory review and does not replace professional regulatory judgment or official guidance issued by the Saudi Food and Drug Authority (SFDA).

---

## License

This project is currently maintained as a private academic project.

All rights reserved © 2026 Hawkim Team.
