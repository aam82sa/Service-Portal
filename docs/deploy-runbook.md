# Deploy runbook

Steps to bring a Supabase environment (hosted project or a long-lived local
stack) up to date. Migrations and code are reproducible from the repo; the
items marked **once per environment** hold secrets or platform config that
migrations cannot carry.

## 1. Database

Apply any unapplied files from `supabase/migrations/` in filename order — SQL
editor on hosted, `supabase db reset`/`db push` locally. Enum-adding
migrations (e.g. 00037) must run as their own statement batch on hosted.

## 2. Edge Function

```bash
supabase functions deploy send-notification   # verify_jwt=false via config.toml
```

Function secrets (Dashboard → Edge Functions → Secrets) — **once per
environment**:

| Secret | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `smtp` (or `graph` once an Entra tenant exists) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Mailtrap sandbox (testing) or the production relay |
| `HOOK_SECRET` | long random string — same value as the Vault entry below |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` / `GRAPH_SENDER` | only when `EMAIL_PROVIDER=graph` |

## 3. Vault — dispatch secret (**once per environment**)

Migration 00046 wires `request_events` INSERT → `net.http_post` to the
function, reading `X-Hook-Secret` from Vault at send time. **Vault contents
cannot be seeded by migrations** (secrets must never live in the repo), so
run this once in the SQL editor of every environment that should dispatch
emails:

```sql
select vault.create_secret('<HOOK_SECRET value>', 'hook_secret');
```

- Use the same value as the function's `HOOK_SECRET` secret.
- Rotating: update both places — `select vault.update_secret(id, '<new>')`
  (find the id in `vault.secrets`) and the function secret, then redeploy.
- Environments **without** the Vault entry (fresh local stacks, CI) skip
  dispatch silently by design — no test traffic reaches the hosted function.
- If a dashboard Database Webhook for `request_events` exists from before
  00046, delete it — otherwise every event dispatches twice.

## 4. Feature flags

System console → Feature toggles: enable **SLA engine** and
**Email notifications** when the environment is ready to act on them
(both ship off).

## 5. Smoke test

Walk `e2e/email-smoke.md`: submit a request as `biz1`, confirm the
"request received" mail in Mailtrap; resolve it, confirm the resolution
mail; with a breached demo request, confirm the escalation mail after one
5-minute cron cycle.
