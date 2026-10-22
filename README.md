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

New SOP submissions use internal parallel review:

1. The main Author selects eligible reviewers from the SOP's home department after a current compliance check. Authors and co-authors cannot review their own SOP.
2. Every selected reviewer receives a task simultaneously. Each can start work and independently complete a review with optional feedback, or reject with a required reason.
3. Rejection immediately returns the SOP to its Author, closes the round and automatically cancels unfinished tasks. Completed decisions, feedback and explicit cancellation reasons remain in the history.
4. The main Author can cancel an undecided task, including one already started. Cancelling every task before any final decision returns the SOP to Draft and permits a new request without erasing the old one.
5. Resubmission after rejection requires a revised version and completed current compliance check. Required reviewers receive fresh tasks together; decisions remain attached to their original round and version. Manually cancelled tasks remain waived; automatically cancelled tasks are required again.
6. Successful internal reviews leave the SOP In Review, awaiting the next Author-controlled action. External routing and Submit for Approval are separate work and are not implemented for this new flow yet.

Overall request and individual task deadlines are optional, independent calendar dates from tomorrow through 30 days from today. Original Time Given is stored separately from Due Date and Remaining Days. Individual tasks with no deadline do not inherit the request deadline. Resubmission restarts the original allocations. Request reminders go to the main Author; task reminders go to each pending reviewer. Closed or cancelled tasks stop reminders.

Shared workflow contract: Sop.internalReviewRounds stores version-linked internal rounds. Each round and assignment has its own ID; decisions and cancellations validate both IDs against the latest open round. Sop.reviewers projects the latest round for existing views. A completed internal round is the integration boundary for the external-routing teammate; it does not represent approval. Future routing must preserve previous rounds, decisions and timeline events. Passive task/deadline helpers respect the active status and an explicit subsequent review plan; internalReviewsComplete is distinct from completion of all required assignments. Legacy routing and approval mutation adapters still reject internal rounds: the external-routing/approval work must supply explicit Author-controlled entry transitions, signed-in actor eligibility checks and matching UI actions. No status or historical event alone authorizes those mutations. Reviewer-facing document and compliance views expose only internally assigned versions; historical links cannot reveal a later unassigned version. Cancelling an assignment never changes global Reviewer permission or another SOP assignment; cancelled assignments do not block user administration.

Existing SOPs without internal rounds keep their legacy sequential review and approval behavior, including previously configured department routing. No in-flight record is silently migrated. Department workflow configuration and all SOP changes remain in memory and reset on reload. Submitted versions remain protected from deletion.

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

```bash
cd frontend
npm install
npm run dev
```

Then open the local URL printed in the terminal (usually http://localhost:5173).

To sign in, use one of the sample accounts in [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md) (any password works).

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
