-- PMO module, step 1: new project-scoped roles.
-- MUST run alone (Postgres forbids using a new enum value in the same
-- transaction that created it) — run 00025 immediately after.
-- Spec: docs/pmo-gap-decisions.md §J
alter type platform_role add value if not exists 'project_manager';
alter type platform_role add value if not exists 'pmo_admin';
