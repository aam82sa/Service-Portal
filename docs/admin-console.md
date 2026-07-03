# Admin Console — Specification

Decisions agreed 2026-07-03. This document is the source of truth for the admin
functions; the access matrix and architecture docs reference it.

## Role model
`platform_admin` is **split into two roles** (added to the `platform_role` enum):

| Role | Console section | Scope |
|---|---|---|
| `user_admin` | Users & Directory | Manage users, assign/revoke roles, AD group→role mappings, approval delegation, teams |
| `system_admin` | System console | Feature toggles, email templates + inbound routing, DoA matrix, SLA policies, workflows, forms oversight, announcements, audit viewer, CSAT, API keys, retention |

- The Admin page (and its nav entry) renders **only** for holders of one of these
  roles; RLS blocks the underlying data regardless of UI.
- Suggested AD groups: `SG-RLC-User-Admins`, `SG-RLC-System-Admins`.
- Dept Admins keep their per-department catalog/SLA scope (forms and workflows
  for their own department's services).

## 1. Feature toggles
- `feature_flags` table: key, name, description, category, `is_enabled`,
  `updated_by`, `updated_at`.
- Every module checks its flag **in the database/Edge layer**, not only the UI.
- Toggle changes are audit-logged. System Admin only.

## 2. Configurable response emails
- `notification_templates` gains: per-event enable switch, **per-department
  overrides** (nullable `dept` column; fallback to platform default), placeholder
  variables (`{{ref}}`, `{{requester_name}}`, `{{service}}`, `{{status}}`,
  `{{title}}`, `{{sla_due}}`, `{{rating_link}}`).
- Editable in the System console (subject + HTML body per lifecycle event).

## 3. Email-to-ticket (inbound)
- Graph webhook subscription on service mailbox(es); Edge Function receiver.
- Known sender (matched to profile by email/UPN) → new request + configured
  acknowledgement. Unknown sender → configurable "not recognized" reply, no ticket.
- Replies containing a `REQ-` ref in the subject append a requester comment.
- **Routing rules table** (admin-editable): mailbox/alias → department + default
  service, with catch-all.
- Extra Entra permissions: `Mail.Read` + subscription renewal (beyond `Mail.Send`).
- Whole channel sits behind a feature flag.

## 4. Admin catalog (benchmarked vs ServiceNow / Freshservice / Jira SM)
**User Admin:** directory (activate/deactivate synced users), role assignments +
group mapping editor, **approval delegation / out-of-office** (date-ranged,
audit-logged), **teams within departments** (sub-queues for assignment/reporting).

**System Admin:** SLA policy editor (targets per service & priority; business-hours
+ **Saudi holiday calendar**; pause while `pending_requester`), escalation rules
(SLA warning/breach → notify / bump priority / escalate), priority matrix
(impact × urgency → P1–P4), auto-assignment rules (round-robin / load-based),
announcements/banners, audit log viewer + CSV export, CSAT settings, API keys +
outbound webhooks, data retention policy.

## 5. No-code form builder
- Per-service form definition in `services.form_schema` (JSONB), edited visually.
- Per field: **visible + mandatory toggles**, label, help text, type (text, long
  text, number, amount SAR, date, dropdown, yes/no, cost center, attachment).
- **Conditional rules** (show/require field when another field matches a value —
  e.g. cost center required when amount ≥ 25,000).
- **Versioned**: requests snapshot the form version they were submitted with.
- Submissions **validated server-side** against the stored schema.
- Dept Admins edit their department's forms; System Admin platform-wide.

## 6. Graphical workflow designer
- Per-service workflow stored as a JSONB graph (steps + transitions); visual
  canvas editor.
- Triggers on enter/exit/timeout of any step, with conditions: send template
  email, assign/reassign, request approval (DoA chain), change priority,
  escalate, start/pause SLA clock, fire webhook, add checklist task.
- **Guardrails validated before publish**: starts at New, ends at Closed, no
  unreachable steps/dead ends, approval steps cannot be removed when the service
  requires approval or the amount hits a DoA band, every transition audit-logged.
- **Draft → validate → publish** with versions; in-flight requests finish on
  their original version.
- Transitions **enforced server-side**: the DB rejects moves not present in the
  published workflow.

## Build-order impact (re-sequenced phases)
1. Schema + RLS (extended: flags, roles split, calendars, teams, delegation,
   workflow/form versioning)
2. Auth + Entra group→role sync (dev sign-in mode first; SSO swap-in later)
3. Service catalog + request lifecycle (workflow **engine** as data)
4. DoA approvals engine + delegation
5. Graph email: outbound templates + **email-to-ticket inbound**
6. Admin console UI (toggles, email studio, form builder, users & roles)
7. Workflow designer **canvas** (engine already live from phase 3)
8. My Work + agent workspace
9. Executive insights dashboards
