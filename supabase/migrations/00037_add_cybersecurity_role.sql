-- Admin catalog v2, step 1: the Cybersecurity role.
-- MUST run alone (Postgres forbids using a new enum value in the same
-- transaction that created it) — run 00038 immediately after.
-- Separation of duties: security approver is its own role, distinct from the
-- IT staff who implement access (suggested AD group: SG-ABC-Cybersecurity).
alter type platform_role add value if not exists 'cybersecurity';
