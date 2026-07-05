# ABC Corp Services Hub

Internal services management platform for ABC Corp — IT Services, Administration, and Logistics.
ITIL-aligned service catalog, request lifecycle, SLA engine, DoA approvals, and executive insights.

## Stack
React 18 + Vite + TypeScript · Supabase (Postgres/RLS/Edge Functions) · Entra ID SSO · Microsoft Graph email

## Repo map
- `CLAUDE.md` — project instructions Claude Code reads every session (start here)
- `prototype/design-reference.html` — approved interactive design (open in a browser)
- `docs/` — architecture, access matrix, build phases
- `supabase/migrations/` — database schema and RLS

## Workflow
`main` is protected. All work happens on `feature/<module>` branches, merged by PR.
See CLAUDE.md → "Git workflow".
