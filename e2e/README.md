# End-to-end tests

Playwright journeys against a **local Supabase stack** and the Vite dev server.
Two golden journeys are covered this sprint:

1. `journey1-request-lifecycle` — requester submits AC-03 → agent triages →
   resolves → requester sees it resolved with the lifecycle bar on step 5.
2. `journey2-doa-chain` — HW-01 at 30,000 SAR → manager approval → the DoA
   Tier 2 (department head) step appears and approves → resolve gate opens.

## One-time setup

```bash
# 1. Local Supabase (requires Docker)
npx supabase start          # boots Postgres/auth/REST on :54321

# 2. Point the app at the local stack (supabase start prints these values)
cat > .env.local <<'ENV'
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from `supabase status`>
VITE_AUTH_MODE=dev
ENV

# 3. Apply migrations + seeds (includes the tester matrix from 00035:
#    biz1/agent.it/head.it… password AbcHub!2026)
npx supabase db reset

# 4. Browsers
npx playwright install chromium
```

## Run

```bash
npm run test:e2e            # boots the dev server itself (playwright.config.ts)
E2E_BASE_URL=http://localhost:4173 npm run test:e2e   # against a preview build
```

Notes

- The journeys create their own uniquely-named requests, so re-runs don't
  collide; `supabase db reset` gives a pristine stack whenever needed.
- In CI the `e2e` job (`.github/workflows/ci.yml`) runs this exact flow via
  `workflow_dispatch` and nightly at 03:00 UTC. It is non-blocking this
  sprint — unit tests + typecheck are the PR gate.
