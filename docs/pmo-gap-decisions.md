# PMO Module — Gap Decisions

Proposed 2026-07-05, pending approval. Resolves the gaps between the
"RLC PMO Module Technical Specification" (v1.0) and the current codebase.
Once approved, this document is the source of truth where it and the spec
disagree; the spec remains authoritative for everything not listed here.

## A. Codebase alignment (translation rules, apply throughout)

| Spec says | This codebase | Rule |
|---|---|---|
| `service_requests` table | `requests` (shared by all depts) | All FK additions (`project_id`, `project_task_id`) go on `requests` |
| `has_role(auth.uid(), 'x')` | `has_role(role, dept default null)` — reads `auth.uid()` internally | Use the existing signature; extend, don't redefine |
| `references auth.users(id)` | Platform convention is `references profiles(id)` | All people FKs reference `profiles` |
| `department_scope text[]` | `dept_code` enum (`IT`, `ADMIN`, `LOG`, `PROC`) | Column type is `dept_code[]`, default `'{}'` |
| Roles incl. "Platform Admin" | `platform_admin` was split into `user_admin` + `system_admin` (docs/admin-console.md) | Global-admin RLS checks use `system_admin`; user/role management stays with `user_admin` |
| Migration `0006_pmo_module.sql` | Repo is at `00023` | PMO migrations start at `00024`, one migration per build phase (6a → `00024_pmo_schema.sql`, etc.) |
| Merge into `develop` | `main` is protected; feature branches by PR | Branches `feature/pmo-*` as per spec §12, merged into `main` |
| RLC branding, `SG-RLC-*` groups | Rebranded to ABC Corp (00023) | All naming, seeds, and suggested AD groups use `SG-ABC-*` |

## B. DoA engine generalization (spec §2.2, §7.3)

The spec assumes charters and change requests "reuse the DoA engine as-is",
but the engine is a trigger on `requests` writing `approvals` rows keyed by
`request_id`.

**Decision: generalize `approvals` to a polymorphic subject.**

- Add `subject_type text not null default 'request'`
  (`request` | `project_charter` | `change_request`) and `subject_id uuid`;
  backfill `subject_id` from `request_id`, keep `request_id` as a
  generated/legacy column until the UI is migrated.
- Extract the chain-generation logic from the request trigger into a shared
  function `generate_doa_chain(subject_type, subject_id, dept, service_id, amount)`;
  the existing request trigger and new triggers on `project_charters` and
  `change_requests` all call it. `doa_matrix` is unchanged (dept null =
  global rows already supported — charters route through global/PROC rows
  per spec §2.2's "Procurement administers project spend").
- One approvals queue UI serves all three subject types; `/pmo/approvals`
  is a filtered view of the same data, not a new mechanism.

**Decision: no `cost_tier` column on `projects`.** Tier is not stored on the
project; `project_charters.doa_tier` is snapshotted at submission (from the
matrix rows the chain was built from) for audit stability. UI displays the
charter's tier.

## C. EVM computability (spec §9)

- **BAC** = sum of `budget_lines.planned_amount` in the current cost baseline.
- **Time-phasing (PV):** each budget line's `planned_amount` spreads
  **linearly** across its WBS element's planned date range (derived from its
  tasks' min start / max end; falls back to the project's planned range if the
  element has no dated tasks). Daily granularity, computed by the EVM function,
  never stored per-day.
- **Earning rule (EV):** EV = `percent_complete` × task's baseline cost share.
  Tasks fulfilled by tickets derive `percent_complete` from the status map in
  §D. Milestone-only WBS elements earn 0/100.
- **Labor cost:** **excluded from EVM v1.** AC = procurement/manual actuals
  only (`project_financial_links`), exactly as the spec defines it. Timesheets
  capture effort for utilization reporting only. A blended-rate option
  (`system_settings` key, hours × rate → AC) is a later additive change; the
  v1 dashboard states "external spend only" on cost metrics so CPI is not
  misread on labor-heavy projects.

## D. Task ↔ ticket status mapping (spec §7.2, §8.1)

For tasks with `fulfillment_department` set, the linked request drives the task:

| `request_status` | Task status | `percent_complete` |
|---|---|---|
| `new`, `triaged` | To Do | 0 |
| `in_progress`, `pending_requester`, `escalated` | In Progress | 25 |
| `pending_approval` | Blocked | 25 |
| `resolved` | Done | 100 |
| `closed` | Done | 100 |
| `cancelled` | Blocked + flagged issue | unchanged |

A cancelled fulfillment ticket does not silently complete or delete the task:
the task goes Blocked and an `issues` row is auto-raised for the PM to
re-plan or re-raise the request.

## E. Conversion semantics (spec §2.4–2.5, §7.4)

- **The source ticket stays open** and becomes the project's first linked
  task: on approval, a root WBS element and one task are created, linked to
  the request (`requests.project_id`/`project_task_id` set). Ticket history,
  comments, and payload stay on the ticket; nothing is copied.
- **Proposed PM**: the conversion requester nominates a PM (default:
  themselves) on the conversion request; the nomination takes effect when the
  Department Head approves. PMO Admin can reassign afterwards.
- **Dept Head converting their own ticket**: allowed — the approval step is
  still recorded (self-approved), keeping the audit trail uniform rather than
  special-casing the gate away.
- Conversion approval is **not** a DoA/spend approval and does not use the
  approvals table; `project_conversion_requests.status` + `decided_at` +
  `department_head_id` is the record, per spec §2.5.

## F. Scheduling engine scope (spec §5, phase 6c)

**Decision: manual scheduling with dependency validation in v1.**
Dates are entered by the PM; `task_dependencies` are enforced as warnings
(UI flags a successor starting before predecessor finish + lag), not as an
auto-scheduler. Critical path is computed client-side for display on the
schedule view only. Auto-CPM rescheduling is out of scope for Phase 6 —
revisit after real usage.

## G. Missing entities the spec references

Added to the 6a schema:

- `project_templates` (name, description, department_scope, is_active)
- `wbs_template_elements` (template_id, parent_id, code, title, sequence) —
  what `create-project-from-charter` instantiates when a template is selected.
- `stakeholders`: replace ambiguous `name_or_user_id` with `user_id uuid null
  references profiles(id)` + `external_name text null` + check constraint
  (exactly one set).

## H. Re-baselining (spec §7.3 "Baseline Updated")

When a change request reaches Implemented, the PM triggers re-baseline from
the CR detail view: new `project_baselines` rows (version n+1) are written
for each baseline type the CR impacted (`impact_cost` → cost,
`impact_schedule_days` → schedule, scope text → scope). The CR stores the
baseline versions it produced. Old versions are never mutated; EVM always
reads the highest version per type. Sponsor consent is carried by the CR's
DoA approval — no second approval to re-baseline.

## I. Lifecycle clarifications (spec §7.1)

- **On Hold** pauses milestone reminders and approval-escalation timers for
  the project; linked fulfillment tickets keep their own SLAs (departments
  still own their queues).
- **Terminating an Active project**: allowed via Closing with
  `project_closures.closure_type` = `completed` | `terminated`. `Cancelled`
  remains pre-Active only, matching the spec's state machine.
- **Manual vs linked financials**: a budget line's committed/actual comes
  from **either** its manual fields **or** its linked records, exclusively —
  once a `purchase_request_id`/`purchase_order_id` link exists on a
  `project_financial_links` row, its manual amounts are ignored by EVM (and
  the UI locks them), eliminating double-count risk when Procurement ships.
- **Over-allocation**: sum of a person's `allocation_percent` across active
  projects > 100% is a warning surfaced on assignment, not a hard block.

## J. Roles (spec §4)

- New `platform_role` enum values: `project_manager`, `pmo_admin`.
- Sponsor, Portfolio Executive, Team Member, Department Head map to existing
  roles as the spec describes (`dept_head` already exists — migration 00014).
- **Program manager is not a role**: `programs.program_manager_id` is a
  designation (like `projects.project_manager_id` scoping), requiring the
  holder to have the `project_manager` role.
- Dev mode: roles seeded via `role_assignments` exactly like existing roles;
  Entra group mapping (`SG-ABC-Project-Managers`, `SG-ABC-PMO-Admins`) is
  recorded in docs/access-matrix.md but wired up only when SSO mode is enabled.

## K. Infrastructure prerequisites

The repo has no `supabase/functions/` yet; spec §10 assumes several. Order
of introduction:

1. **6b**: none required (DoA chain is in-database, as today).
2. **6c**: `sync-fulfillment-status` — implemented as a **database trigger**
   on `requests` (not an Edge Function): the status map in §D is pure SQL and
   a trigger avoids the Realtime/Edge dependency entirely.
3. **6d**: manual entry only (spec §8.2.1); `sync-procurement-actuals`
   deferred until Procurement ships. `PROCUREMENT_INTEGRATION_ENABLED` lives
   in `feature_flags` (existing table), not an env var.
4. **6f**: `calculate-evm-metrics` — first real Edge Function; scheduled via
   **pg_cron** (`select cron.schedule(...)` calling the function through
   `pg_net`), nightly at 02:00 Asia/Riyadh.
5. **6g**: `notify-milestone-due`, `escalate-pending-approvals`, and the
   Graph `sendMail` function — built together, business-hours aware via the
   existing `business_hours` table (Sun–Thu already seeded).

## L. Project code sequence

`projects.code` follows the request pattern: dedicated sequence,
`'PJ-' || lpad(nextval('project_seq')::text, 4, '0')` (PJ-0001…), JetBrains
Mono in UI. WBS codes are materialized dot-paths (`1.2.3`) maintained on
insert/re-order.
