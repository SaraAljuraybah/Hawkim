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

1. The main Author sends review requests for the current version, after a current compliance check, to eligible reviewers from the SOP's home department. Authors and co-authors cannot review their own SOP. Each request can have an optional response due date and an optional review duration (1–30 calendar days). The Riyadh working-day policy (a fixed response date two working days after sending, and 1–30 working days) is pending activation; see below.
2. A reviewer must respond first: **Accept** (the review duration starts) or **Decline** with a required reason.
3. After accepting, the reviewer either **Returns to author** (comments required) or **Completes the review** (optional comments). A return affects only that reviewer; the SOP stays In Review.
4. A request still pending when its response due date has ended is **withdrawn automatically**. This is the only automatic action (the rule is `withdrawalDueAt` in `src/lib/internalReviewStatus.ts`; the real withdrawal must run on the backend). A passed review duration only marks the request Overdue.
5. The main Author can **remove a reviewer** at any time, whatever their status, with a required reason, and can **add reviewers** for the same version while the review is open or after it settled (which reopens it). Declined, withdrawn and removed reviewers can be asked again; after a return, a new version is needed.
6. Once every reviewer taking part has finished the current version (returned or completed it), or nobody is taking part, the Author can upload, check and send a **new version** to the reviewers they choose, as a new round. A version never sent to a reviewer can be deleted while In Review.
7. The review phase is done when the latest round is on the current version and every reviewer taking part completed it. **Submit for approval** stays visible and lists what is still missing until then.

Deadlines: the response due date ends at the end of that day in Riyadh (as the database saves it). The time to respond follows working hours (`src/lib/responseTime.ts`): a request sent before 8:00 AM counts from 8:00 AM that day, one sent from 8:00 AM to 3:59 PM counts from the moment it is sent, and one sent at 4:00 PM or later counts from 8:00 AM the next calendar day, so from 4:00 PM the earliest response due date is tomorrow. Only the time to respond shown when sending changes: the deadline, the automatic withdrawal and the review duration stay the same, and the reviewer can accept or decline at any time. The review is due at the end of the last day of the duration, counted from that reviewer's acceptance (accepted Oct 25 at 3 PM + 5 days = due Oct 30, 11:59 PM). The app always shows the deadlines the database saved; it never recalculates them.

**Working-day deadlines: pending activation.** The intended policy is Asia/Riyadh, Sunday to Thursday (Friday and Saturday excluded), a fixed response deadline at the end of the second working day after sending (the sending date not counted), and an optional review duration of 1–30 working days after acceptance (the acceptance date not counted), each ending at 23:59:59.999 Riyadh time, without recalculating saved deadlines. The frontend implementation is ready behind one switch, `WORKING_DAY_DEADLINES_ACTIVE` in `src/lib/deadlinePolicy.ts` (currently `false`); the matching database change is a proposal in `supabase/proposals/` (see its `REVIEW_NOTES.md`). Both are switched on together, only after the database owner approves and applies the migration.

Reviewers get 24-hour reminders to respond and to finish. The main Author is notified of declines, returns, each completed review, the phase being done, withdrawals and overdue reviews; co-authors of declines and returns; reviewers of removals and withdrawals.

Shared workflow contract: `Sop.internalReviewRounds` stores one round per version. Each request (assignment) has its own ID; a reviewer's latest request in a round is the one that counts, and earlier ones stay in the history. The round status is recalculated after every change: open (someone taking part hasn't finished, or nobody is taking part), completed, or changes-requested. `Sop.reviewers` projects each reviewer's latest request for existing views. A completed round on the current version is the boundary for approval (`ApprovalSubmission.internalReviewRoundId`) and for the external-routing teammate (`ExternalReviewGate.internalReviewRoundId`); it does not represent approval. Reviewer-facing document and compliance views expose only versions sent to that reviewer; historical links cannot reveal a later unassigned version. Removing a reviewer never changes their global Reviewer permission or another SOP's requests; declined, withdrawn and removed requests do not block user administration.

Existing (sample) SOPs without internal rounds keep their legacy sequential review and approval behavior. Reviewers can repeat a saved handoff to an already assigned eligible reviewer with the original deadline. New reviewer assignments remain Author-controlled; new cross-department routing is pending. No in-flight record is silently migrated. Department workflow configuration and all SOP changes remain in memory and reset on reload. Submitted versions remain protected from deletion.

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

Sign-in, people, departments, guideline versions, SOPs, files, co-authors, compliance checks and internal review are saved in Supabase. The compliance check applies only to Pharmacovigilance SOPs. Approval, the admin portal and access to other departments are not in the database yet: they stay in this browser tab and reset on reload.

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
