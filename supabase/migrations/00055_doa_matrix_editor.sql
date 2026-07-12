-- 00055 — DoA matrix editor (SPRINT3 branch 3): the platform approval
-- bands (doa_matrix rows with dept null / service null, seeded in 00001)
-- become editable through one validated RPC. The whole band set is saved
-- atomically so gaps/overlaps can never exist between saves.

create or replace function save_doa_bands(p_bands jsonb) returns void
language plpgsql security definer as $$
declare
  b jsonb;
  prev_max numeric := 0;                     -- coverage must start at 0 SAR
  i int := 0;
  nb int;
  mn numeric;
  mx numeric;
begin
  if not has_role('system_admin') then
    raise exception 'only a system admin can edit the DoA matrix';
  end if;
  if p_bands is null or jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 then
    raise exception 'bands payload must be a non-empty array';
  end if;
  nb := jsonb_array_length(p_bands);

  for b in select * from jsonb_array_elements(p_bands) loop
    i := i + 1;
    mn := (b ->> 'min_amount')::numeric;
    mx := (b ->> 'max_amount')::numeric;     -- null only on the last band
    if mn is null or mn <> prev_max then
      raise exception 'DoA bands must be contiguous with no gaps or overlaps: band % starts at % but the previous band ends at %',
        i, coalesce(mn::text, 'null'), prev_max;
    end if;
    if i < nb then
      if mx is null or mx <= mn then
        raise exception 'band % needs a ceiling above its floor (% SAR)', i, mn;
      end if;
    elsif mx is not null then
      raise exception 'the last band must be open-ended (no ceiling)';
    end if;
    if jsonb_typeof(b -> 'steps') <> 'array' or jsonb_array_length(b -> 'steps') = 0 then
      raise exception 'band % needs at least one approver step', i;
    end if;
    if exists (
      select 1 from jsonb_array_elements(b -> 'steps') s
      where coalesce(btrim(s ->> 'approver_hint'), '') = ''
    ) then
      raise exception 'band %: every step needs an approver', i;
    end if;
    prev_max := mx;
  end loop;

  delete from doa_matrix where dept is null and service_id is null;
  for b in select * from jsonb_array_elements(p_bands) loop
    insert into doa_matrix (dept, service_id, min_amount, max_amount, step_order, approver_role, approver_hint)
    select null, null,
           (b ->> 'min_amount')::numeric,
           (b ->> 'max_amount')::numeric,
           t.ord::int,
           coalesce(nullif(t.s ->> 'approver_role', ''), 'approver')::platform_role,
           btrim(t.s ->> 'approver_hint')
    from jsonb_array_elements(b -> 'steps') with ordinality t(s, ord);
  end loop;

  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'doa_matrix', 'bands_updated', jsonb_build_object('bands', p_bands));
end $$;
