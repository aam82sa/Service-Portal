-- 00050 — form conditionals (SPRINT2 branch 3): show/require-if rules on
-- form fields, evaluated live in the request form (src/lib/formRules.ts)
-- and re-evaluated here so the server never trusts the client.
--
-- Rule shape (stored per field as `rules: [...]` in services.form_schema):
--   { "when": "<field key>", "op": "eq|neq|gte|lte|in",
--     "value": <scalar or array>, "effect": "show|require" }
--
-- Semantics (kept byte-identical with the TypeScript evaluator):
--   - a field with `show` rules is visible only while ALL of them hold
--   - a field is required when its static flag is set OR any `require`
--     rule holds — and only while the field is visible
--   - a rule whose `when` key is not a field of the form is inert
--   - eq/neq compare stringified values; gte/lte compare numerically
--     (non-numeric operands make the rule fail); `in` expects an array
--   - a field hidden by rule is IGNORED server-side: its submitted value
--     is never validated and never required

-- ============ rule evaluation ============
create or replace function form_rule_holds(r jsonb, payload jsonb) returns boolean
language plpgsql immutable as $$
declare
  v jsonb := payload -> (r ->> 'when');
  vt text;
  rt text;
begin
  vt := case
    when v is null or v = 'null'::jsonb then ''
    when jsonb_typeof(v) = 'array'
      then (select coalesce(string_agg(x.e, ','), '') from jsonb_array_elements_text(v) x(e))
    else v #>> '{}'
  end;
  rt := case
    when r -> 'value' is null or r -> 'value' = 'null'::jsonb then ''
    when jsonb_typeof(r -> 'value') = 'array'
      then (select coalesce(string_agg(x.e, ','), '') from jsonb_array_elements_text(r -> 'value') x(e))
    else r #>> '{value}'
  end;

  case coalesce(r ->> 'op', '')
    when 'eq' then return vt = rt;
    when 'neq' then return vt <> rt;
    when 'gte' then
      begin
        return vt::numeric >= rt::numeric;
      exception when others then
        return false;                      -- non-numeric operand → rule fails
      end;
    when 'lte' then
      begin
        return vt::numeric <= rt::numeric;
      exception when others then
        return false;
      end;
    when 'in' then
      return jsonb_typeof(r -> 'value') = 'array' and exists (
        select 1 from jsonb_array_elements_text(r -> 'value') x(e) where x.e = vt);
    else
      return false;                        -- unknown operator → rule fails
  end case;
end $$;

-- ============ submission validator, rules-aware ============
-- Same contract as 00049, extended: per-field visibility/required now come
-- from the rules. Child requests (orchestration work orders) stay exempt.
create or replace function validate_request_payload() returns trigger
language plpgsql security definer as $$
declare
  schema jsonb;
  schema_keys jsonb;
  f jsonb;
  r jsonb;
  v jsonb;
  k text;
  t text;
  lbl text;
  vis boolean;
  req boolean;
begin
  if new.parent_request_id is not null then
    return new;
  end if;
  select coalesce(s.form_schema, '[]'::jsonb) into schema
  from services s where s.id = new.service_id;
  if schema is null or jsonb_typeof(schema) <> 'array' then
    return new;
  end if;

  select coalesce(jsonb_object_agg(e ->> 'key', true), '{}'::jsonb) into schema_keys
  from jsonb_array_elements(schema) e where e ->> 'key' is not null;

  for f in select * from jsonb_array_elements(schema) loop
    k := f ->> 'key';
    t := coalesce(f ->> 'type', 'text');
    lbl := coalesce(f ->> 'label', k);
    vis := coalesce((f ->> 'visible')::boolean, true);
    req := coalesce((f ->> 'required')::boolean, false);
    if k is null then continue; end if;

    -- rules: ALL show rules must hold; ANY holding require rule requires.
    -- Rules pointing at keys outside this form are inert.
    if jsonb_typeof(f -> 'rules') = 'array' then
      for r in select * from jsonb_array_elements(f -> 'rules') loop
        if r ->> 'when' is null or not (schema_keys ? (r ->> 'when')) then
          continue;
        end if;
        if r ->> 'effect' = 'show' and vis and not form_rule_holds(r, new.payload) then
          vis := false;
        elsif r ->> 'effect' = 'require' and not req and form_rule_holds(r, new.payload) then
          req := true;
        end if;
      end loop;
    end if;
    if not vis then continue; end if;      -- hidden (statically or by rule): value ignored

    v := new.payload -> k;

    if req and (
      v is null or v = 'null'::jsonb
      or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
      or (t = 'attachment' and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0))
    ) then
      raise exception 'field "%" is required', lbl;
    end if;

    if v is null or v = 'null'::jsonb then continue; end if;

    if t = 'yesno' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'field "%" must be a yes/no value', lbl;
      end if;
    elsif t = 'costcenter' then
      if not exists (select 1 from cost_centers c where c.code = v #>> '{}' and c.is_active) then
        raise exception 'field "%": unknown or inactive cost center %', lbl, v #>> '{}';
      end if;
    elsif t = 'attachment' then
      if jsonb_typeof(v) <> 'array' then
        raise exception 'field "%" must be a list of attachment paths', lbl;
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v) p(path)
        where p.path not like new.id::text || '/%'
      ) then
        raise exception 'field "%": attachment paths must live under this request', lbl;
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v) p(path)
        where not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'attachments' and o.name = p.path and o.owner = new.requester_id
        )
      ) then
        raise exception 'field "%": attachment missing or not uploaded by the requester', lbl;
      end if;
    elsif t = 'asset_picker' then
      if not exists (
        select 1 from assets a
        where a.id = (v #>> '{}')::uuid and a.assigned_to = new.requester_id
      ) then
        raise exception 'field "%": asset is not assigned to the requester', lbl;
      end if;
    elsif t = 'employee_picker' then
      if not exists (select 1 from profiles p where p.id = (v #>> '{}')::uuid) then
        raise exception 'field "%": unknown employee', lbl;
      end if;
    end if;
  end loop;
  return new;
end $$;

-- (trigger requests_validate_payload from 00049 keeps pointing at this function)

-- ============ seed: AC-02 end date is conditional on duration ============
-- "End date (required if temporary)" becomes real behavior: hidden until
-- duration = Temporary, then mandatory. Re-running overwrites the same
-- rules, so this is idempotent.
update services
set form_schema = (
  select jsonb_agg(
    case when e ->> 'key' = 'end_date'
      then e || jsonb_build_object('rules', jsonb_build_array(
        jsonb_build_object('when', 'duration', 'op', 'eq', 'value', 'Temporary', 'effect', 'show'),
        jsonb_build_object('when', 'duration', 'op', 'eq', 'value', 'Temporary', 'effect', 'require')
      ))
      else e
    end
  order by o.ord)
  from jsonb_array_elements(form_schema) with ordinality o(e, ord)
)
where code = 'AC-02'
  and jsonb_path_exists(form_schema, '$[*] ? (@.key == "end_date")')
  and jsonb_path_exists(form_schema, '$[*] ? (@.key == "duration")');
