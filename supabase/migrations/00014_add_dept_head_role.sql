-- Step 1 of the role-group model: add the dept_head role.
-- MUST run alone (Postgres forbids using a new enum value in the same
-- transaction that created it) — run 00015 immediately after.
alter type platform_role add value if not exists 'dept_head';
