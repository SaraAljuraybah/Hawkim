# Demo accounts

These are the sample accounts for demonstrating the Hawkim frontend. Sign in at `/login` with one of the emails below and **any password**. There is no backend yet: all data is sample data held in the browser, and it **resets when the page is reloaded**.

Every user is an employee; permissions (Author, Reviewer, Approver, Admin) add features on top. Admins use only the admin portal.

## Admin

| Name | Department | Permissions | Email |
|---|---|---|---|
| Nouf Almutairi | Information Technology | Admin | nouf.almutairi@hawkim.demo |

## Authors

| Name | Department | Permissions | Email |
|---|---|---|---|
| Sara Aljuraybah | Information Technology | Author | sara.aljuraybah@hawkim.demo |
| Reem Alsubaie | Information Technology | Author | reem.alsubaie@hawkim.demo |
| Omar Alghamdi | Pharmacovigilance | Author | omar.alghamdi@hawkim.demo |

## Reviewers

| Name | Department | Permissions | Email |
|---|---|---|---|
| Noura Alqahtani | Information Technology | Reviewer | noura.alqahtani@hawkim.demo |
| Faisal Alharbi | Quality Assurance | Reviewer | faisal.alharbi@hawkim.demo |
| Lama Alshehri | Pharmacovigilance | Reviewer | lama.alshehri@hawkim.demo |
| Abdullah Alqahtani | Regulatory Affairs | Reviewer | abdullah.alqahtani@hawkim.demo |

## Approvers

| Name | Department | Permissions | Email |
|---|---|---|---|
| Huda Alotaibi | Information Technology | Approver | huda.alotaibi@hawkim.demo |
| Khalid Alzahrani | Quality Assurance | Approver | khalid.alzahrani@hawkim.demo |
| Maha Alenazi | Pharmacovigilance | Approver | maha.alenazi@hawkim.demo |
| Sultan Aldosari | Regulatory Affairs | Approver | sultan.aldosari@hawkim.demo |

## Employees

| Name | Department | Permissions | Email |
|---|---|---|---|
| Rawan Alzahrani | Research & Development | None (employee) | rawan.alzahrani@hawkim.demo |
| Turki Alshammari | Research & Development | None (employee) | turki.alshammari@hawkim.demo |
| Hessa Alqahtani | Human Resources | None (employee) | hessa.alqahtani@hawkim.demo |
| Nasser Alotaibi | Human Resources | None (employee) | nasser.alotaibi@hawkim.demo |
| Dalal Alharbi | Finance & Administration | None (employee) | dalal.alharbi@hawkim.demo |
| Fahad Alanazi | Clinical Operations | None (employee) | fahad.alanazi@hawkim.demo |
| Joud Almutairi | Clinical Operations | None (employee) | joud.almutairi@hawkim.demo |
| Bandar Aldossary | Legal & Governance | None (employee) | bandar.aldossary@hawkim.demo |
| Shahad Alghamdi | Quality Assurance | None (employee) | shahad.alghamdi@hawkim.demo |

## Suggested demo

| Part | Account | What to show |
|---|---|---|
| Employee view | Rawan Alzahrani | Dashboard, SOPs, departments, submitting a request |
| Author | Sara Aljuraybah | Uploading an SOP, submitting it for review, the compliance report, co-authors |
| Reviewer | Noura Alqahtani / Faisal Alharbi | My Reviews, completing a review, returning to the author, routing to another department |
| Approver | Huda Alotaibi | Approving and publishing |
| Admin | Nouf Almutairi | Users, departments, requests and regulations |

Because data resets on reload, switch accounts with **Sign Out** (not a page reload) to follow one SOP through the whole workflow.

> If you add or remove sample users in the code (`frontend/src/data/mock/users.ts`), update this file.
