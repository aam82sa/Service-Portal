# RLC Services Hub — Project Instructions for Claude Code

## What this is
Internal services management platform for RLC covering three departments:
IT Services, Administration, and Logistics. ITIL-aligned: service catalog,
request lifecycle, SLA engine, DoA (Delegation of Authority) approvals,
dashboards. Benchmarked against ServiceNow / Freshservice / Jira SM patterns.

## Stack (fixed — do not change without asking)
- Frontend: React 18 + Vite + TypeScript, plain CSS with design tokens (no Tailwind)
- Backend: Supabase (Postgres, Auth, RLS, Edge Functions, Realtime)
- Auth: Supabase Auth with Microsoft Entra ID (Azure AD) as SSO provider
- Users: mastered in Entra ID; AD security groups map to platform roles (see docs/access-matrix.md)
- Email: Microsoft Graph API `sendMail` via Edge Function, client-credentials flow,
  service mailbox. Templates stored in `notification_templates` table.

## Design system (fixed)
- Reference implementation: `prototype/design-reference.html` — match it closely
- Colors: ink `#10192E`, surface `#F4F5F8`, accent `#D97757`,
  green `#2E9E6B`, amber `#DE9B2D`, red `#D64545`,
  IT `#3E6DD8`, Administration `#8A5FC9`, Logistics `#2E9E6B`
- Fonts: Space Grotesk (headings), Inter (body), JetBrains Mono (IDs, SLA values)
- Formal tone: no emojis in UI; service tiles use 2-letter monospace codes (HW, AC, TR)
- Signature elements: SLA countdown rings on tickets; department color rails;
  DoA approval chain visualization

## Domain rules
- Request IDs: `REQ-` prefix, sequential
- Priorities: P1 Critical, P2 High, P3 Normal, P4 Low
- Lifecycle: New → Triaged → In Progress → Pending Approval → Resolved → Closed
- DoA bands (SAR): Tier 1 < 25k, Tier 2 25k–100k, Tier 3 > 100k
- Access = role permission × department scope, enforced with Postgres RLS,
  never only in the UI. Agents see ONLY their own department's queue.
- Every state change writes to `request_events` (immutable audit log).
- Currency: SAR. Week starts Sunday (Saudi work week Sun–Thu) for SLA business-hours math.

## Code structure (added 2026-07-04 — keep it this way)
- `src/features/<domain>/` — one folder per functionality:
  auth · home · catalog (portal, request form) · requests (my requests, queue,
  my work, approvals, detail) · assets · insights · admin (all console sections
  incl. service/form/workflow builders)
- `src/components/ui.tsx` — shared primitives (Chip, Toggle, MetricCard,
  SectionLabel). New/edited code uses these instead of inline-styled spans.
- `src/lib/` — supabase client + shared types only
- Heavy routes (assets, admin, insights) are lazy-loaded in App.tsx; keep new
  heavy dependencies behind a lazy() boundary.
- When changing a feature, read ONLY its folder + src/lib/types.ts; never
  re-read the whole src tree.
- CI (.github/workflows/ci.yml) builds every PR — keep it green.

## Git workflow (important — minimize token usage)
- `main` is protected; never commit to it directly
- Branch per module: `feature/<module>` (e.g. feature/approvals-engine)
- Small, focused commits with conventional messages: feat:, fix:, chore:, docs:
- When asked for a change, edit only the files involved; do not regenerate
  unrelated files or reformat untouched code
- Open work is merged via PR so diffs stay reviewable

## Build order (phases)
1. Supabase schema + RLS (`supabase/migrations/`)
2. Auth + Entra ID group→role sync
3. Service catalog + request lifecycle
4. DoA approvals engine
5. Graph email notifications
6. My Work personalized view + agent workspace
7. Executive insights dashboards

## Token-efficiency rules for Claude Code
- Read `docs/architecture.md` and this file before large tasks; avoid re-reading
  the whole repo for small edits
- Prefer targeted file edits over rewrites
- Ask before adding new dependencies
