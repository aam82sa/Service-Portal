# Backlog

Tracked work remaining after the Final Build **Phase 1** (dynamic service
streams + tenant foundation), which is merged (PRs #105–#109) and applied to
the hosted demo. Phases 2 and 3 are independent and may be done in either
order.

---

## Phase 2 — PDPL compliance product
Nothing exists in schema today. Build:
- **Retention engine** — `retention_policies (record_type, retain_months, action ['anonymize'|'delete'], legal_hold bool)`; a `pg_cron` sweep (same pattern as `sla_check`) that anonymises/purges past retention; admin console section; every action audited. Issued letter numbers stay permanent (document the exception).
- **DSR console** (data subject rights) — per person: export their data (JSON/CSV bundle), correct, and delete/anonymise, with an audit trail and a request log. Restricted to **User Admin**.
- **Consent + privacy notice** — bilingual notice at first login, consent recorded per user with timestamp/version; sub-processor register (Supabase, email provider, Anthropic) surfaced in the admin console.
- **Breach register** — incident records + a 72-hour notification checklist (reuse the restricted-visibility pattern from security incidents).

## Phase 3 — Procurement chain
The Procurement department exists but the process doesn't. Build the chain
`PR → DoA approval → RFQ (quotes) → PO → GRN → invoice match`:
- Tables: `vendors`, `purchase_requests`, `rfqs` + `rfq_quotes`, `purchase_orders`, `goods_receipts`.
- Reuse the existing DoA approval engine for spend approval, the numbering engine for PO numbers, and the workflow engine for the state machine.
- Roles: `procurement_officer`, `procurement_manager`, scoped to the Procurement stream (just another dynamic department after Phase 1).
- Admin-configurable: approval thresholds via the DoA matrix; vendor register CRUD.

## Phase 1 polish (non-blocking)
Small follow-ups deferred from PR-C/PR-C2. RLS already enforces correctness;
these are UI completeness only.
- **Requester-portal catalog placement of dynamic streams** — `Portal.tsx` groups the catalog into fixed department blocks; make block/placement `dept_id`/table-driven so a new stream's services appear in the portal.
- **Role-affordance chrome on `dept_id`** — the ops queue's show/hide of push/assign buttons is keyed on the department *code*; key it on `dept_id` so affordances render for dynamic-stream rows (the real access boundary is already enforced by RLS).

---

## Open operational note
Production is Entra-SSO-only by design. The demo's password logins + Email
provider were enabled for showcasing and should be re-locked afterwards
(delete `*@dev.abccorp.com`, disable the Email provider) — see the S0 Harden
brief's manual steps.
