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
resolved (with rating link), sla_warning, sla_breached, escalated

## Build phases
1. Schema + RLS  2. Auth + group sync  3. Catalog + lifecycle
4. DoA engine  5. Graph email  6. My Work + workspace  7. Insights
