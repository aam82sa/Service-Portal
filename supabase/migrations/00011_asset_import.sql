-- Bulk asset import with per-row validation, and a hard uniqueness
-- guarantee on serial numbers (two assets can never share a serial).

create unique index assets_serial_unique on assets (serial) where serial is not null;

create or replace function import_assets(p_rows jsonb)
returns jsonb language plpgsql security definer as $$
declare
  r jsonb;
  results jsonb := '[]'::jsonb;
  v_tag text;
  v_serial text;
  v_cat text;
  v_model text;
  n int := 0;
  created int := 0;
begin
  if not is_it_staff() then
    raise exception 'only IT staff can import assets';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    v_tag := upper(nullif(trim(coalesce(r->>'tag', '')), ''));
    v_serial := nullif(trim(coalesce(r->>'serial', '')), '');
    v_cat := lower(nullif(trim(coalesce(r->>'category', '')), ''));
    v_model := nullif(trim(coalesce(r->>'model', '')), '');

    if v_tag is null then
      results := results || jsonb_build_object(
        'row', n, 'tag', '', 'status', 'error', 'message', 'missing asset tag');
    elsif v_cat is null or v_cat not in ('laptop', 'monitor', 'phone', 'printer', 'accessory') then
      results := results || jsonb_build_object(
        'row', n, 'tag', v_tag, 'status', 'error',
        'message', 'category must be laptop, monitor, phone, printer or accessory');
    elsif exists (select 1 from assets where tag = v_tag) then
      results := results || jsonb_build_object(
        'row', n, 'tag', v_tag, 'status', 'duplicate', 'message', 'tag already exists in the system');
    elsif v_serial is not null and exists (select 1 from assets where serial = v_serial) then
      results := results || jsonb_build_object(
        'row', n, 'tag', v_tag, 'status', 'duplicate',
        'message', 'serial number already exists on another asset');
    else
      begin
        insert into assets (tag, category, model, serial)
        values (v_tag, v_cat, v_model, v_serial);
        created := created + 1;
        results := results || jsonb_build_object(
          'row', n, 'tag', v_tag, 'status', 'created', 'message', '');
      exception when unique_violation then
        results := results || jsonb_build_object(
          'row', n, 'tag', v_tag, 'status', 'duplicate',
          'message', 'duplicate tag or serial within the imported file');
      end;
    end if;
  end loop;

  insert into admin_events (actor_id, area, action, detail)
  values (auth.uid(), 'assets', 'imported',
          jsonb_build_object('rows', n, 'created', created));
  return results;
end $$;
