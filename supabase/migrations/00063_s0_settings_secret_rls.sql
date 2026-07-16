-- 00063 — S0 security hardening (4/4): the Anthropic API key leaves the browser.
--
-- correspondence_settings was readable by all staff (cs_read: agent/lead/
-- head/sysadmin), and the letters capture screen fetched every row — so the
-- tenant's Anthropic API key shipped to every staff browser, which then
-- called api.anthropic.com directly. AI reading now runs in the read-letter
-- edge function (key from the ANTHROPIC_API_KEY function secret, falling
-- back to this table via the service role), so clients no longer need the
-- key row at all. Restrict it to system admins (who manage it in Settings);
-- non-secret settings (ai_model, allow_owner_clear_view) stay staff-readable.

drop policy if exists cs_read on correspondence_settings;
create policy cs_read on correspondence_settings for select to authenticated
  using (
    (has_role('agent') or has_role('team_lead') or has_role('dept_head') or has_role('system_admin'))
    and (key <> 'anthropic_api_key' or has_role('system_admin'))
  );
