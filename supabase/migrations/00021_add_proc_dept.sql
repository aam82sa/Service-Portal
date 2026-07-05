-- New department container: Procurement. Enum additions must run in their
-- own migration (00022 uses the value).
alter type dept_code add value if not exists 'PROC';
