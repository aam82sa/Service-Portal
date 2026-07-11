# Email dispatch smoke test (manual)

End-to-end check of the send-notification function against the **Mailtrap
sandbox**. Run after deploying the function and running migration 00044.

## 1. Secrets (Supabase dashboard → Edge Functions → Secrets)

From your Mailtrap inbox → *SMTP settings*:

```
EMAIL_PROVIDER = smtp
SMTP_HOST      = sandbox.smtp.mailtrap.io
SMTP_PORT      = 587
SMTP_USER      = <inbox user>
SMTP_PASS      = <inbox password>
SMTP_FROM      = services-hub@abccorp.com
HOOK_SECRET    = <long random string>
```

## 2. Deploy + wire the trigger

```bash
supabase functions deploy send-notification   # verify_jwt=false via config.toml
```

The dispatch trigger is migration-managed (00046): `request_events` INSERT →
`net.http_post` to the function with the `X-Hook-Secret` header. The secret is
read from **Vault** at send time — store it once in the SQL editor:

```sql
select vault.create_secret('<HOOK_SECRET value>', 'hook_secret');
```

Use the same value as the function's `HOOK_SECRET` secret. This is a
**once-per-environment** step — hosted Vault cannot be seeded by migrations
(secrets must never live in the repo). Stacks without the Vault entry (fresh
local/CI resets) skip dispatch silently. No dashboard webhook is needed —
remove any previously-created one to avoid double sends. Full sequence:
`docs/deploy-runbook.md`.

## 3. Sanity checks

```bash
# rejected without the secret (401)
curl -s -X POST https://<ref>.supabase.co/functions/v1/send-notification -d '{}'

# provider check with the secret (needs email_notifications flag ON)
curl -s -X POST https://<ref>.supabase.co/functions/v1/send-notification \
  -H "X-Hook-Secret: $HOOK_SECRET" -H "content-type: application/json" \
  -d '{"mode":"send","to":"you@example.com","subject":"smoke","html":"<p>hi</p>"}'

# graph token diagnostic (expected to fail until a tenant exists)
curl -s -X POST ... -d '{"mode":"test-auth"}'
```

## 4. The real flow

1. System console → Feature toggles → enable **Email notifications**.
2. Sign in as `biz1@dev.abccorp.com`, submit any request.
3. Mailtrap inbox: **"Your request REQ-xxxx has been received"** arrives.
4. As `agent.it`, assign → triage → start → resolve the request.
5. Mailtrap: assignment + **resolution** emails arrive (requester recipient).
6. With the `sla_engine` flag on and a breached demo request, the sweep's
   `sla_breached` event produces the escalation email to team lead + dept head.

Every skip (flag off, disabled template, no recipients) returns 200 with a
`skipped` reason and a function log line — check Edge Function logs.

## Notes

- The Graph provider (`EMAIL_PROVIDER=graph`, `GRAPH_*` secrets) compiles and
  keeps the `test-auth` diagnostic, but stays untested until an Entra tenant
  exists.
- Template contents/dept overrides and per-event switches are managed in the
  System console → Email studio (`notification_templates`).
