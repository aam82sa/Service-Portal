# Architecture

## Layers
1. React SPA (portal, My Work, dept workspace, approvals, insights, admin)
2. Supabase: Postgres + RLS (authorization), Auth (Entra ID SSO), Realtime (live queues),
   Edge Functions (approval routing, SLA checks via pg_cron, Graph email dispatcher)
3. Microsoft 365: Entra ID (identity + groups), Graph sendMail (notifications)

## Request lifecycle
new → triaged → in_progress → pending_approval → (pending_requester | escalated) → resolved → closed

## Email events
request_created, assigned, pending_approval (actionable), approved/rejected,
resolved (with rating link), sla_warning, sla_breached, escalated.
Templates are admin-editable with per-department overrides; inbound
email-to-ticket via Graph webhook. See docs/admin-console.md §2–3.

## Admin console
Two global admin roles (user_admin / system_admin), feature toggles enforced in
the DB layer, no-code form builder, graphical workflow designer with server-side
transition enforcement. Full spec: docs/admin-console.md.

## Build phases (re-sequenced 2026-07-03)
1. Schema + RLS (incl. flags, calendars, teams, delegation, versioned forms/workflows)
2. Auth + group sync (dev sign-in first, Entra SSO swap-in)
3. Catalog + lifecycle (workflow engine as data)
4. DoA engine + delegation  5. Graph email out + in (email-to-ticket)
6. Admin console UI  7. Workflow designer canvas
8. My Work + workspace  9. Insights
