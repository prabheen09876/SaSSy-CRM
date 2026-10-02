-- Additive migration for the WORKSPACE (SaaS) CRM, not standalone.sql.
-- Review against the live schema before applying. No sources are enabled here.
begin;

do $$
begin
  if to_regclass('public.workspaces') is null or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'workspace_id' and udt_name = 'uuid' and is_nullable = 'NO'
  ) then
    raise exception 'Meta ingestion requires the workspace CRM schema; no changes were applied.';
  end if;
end;
$$;

alter table public.leads
  add column meta_lead_id text,
  add column meta_created_at timestamptz,
  add constraint leads_workspace_meta_lead_id_key unique (workspace_id, meta_lead_id),
  add constraint leads_meta_origin_pair check ((meta_lead_id is null) = (meta_created_at is null));

-- Only the database operator can configure routing. One Page/form pair has one
-- destination; neither a Make payload nor x-workspace-id chooses the workspace.
create table public.meta_lead_intake_sources (
  page_id text not null check (page_id ~ '^[0-9]+$' and length(page_id) <= 64),
  form_id text not null check (form_id ~ '^[0-9]+$' and length(form_id) <= 64),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (page_id, form_id)
);
alter table public.meta_lead_intake_sources enable row level security;
revoke all on public.meta_lead_intake_sources from public, anon, authenticated, service_role;

-- This narrow, server-only function is the integration boundary. Fully
-- qualified objects and an empty search_path prevent object-name substitution.
create function public.ingest_meta_lead(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  allowed_keys constant text[] := array[
    'meta_lead_id', 'page_id', 'form_id', 'submitted_at', 'full_name', 'phone_number',
    'enquiry_intent', 'property_type', 'locality', 'price_or_rent_text',
    'form_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'
  ];
  required_keys constant text[] := array[
    'meta_lead_id', 'page_id', 'form_id', 'submitted_at', 'full_name', 'phone_number',
    'enquiry_intent', 'property_type', 'locality', 'price_or_rent_text'
  ];
  field_name text;
  field_value text;
  destination uuid;
  original_time timestamptz;
  saved_id uuid;
  existing_origin jsonb;
  created boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 32768 then
    raise exception using errcode = '22023', message = 'Expected a JSON object of at most 32 KiB.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) as key where not key = any(allowed_keys)) then
    raise exception using errcode = '22023', message = 'The request contains an unsupported field.';
  end if;
  foreach field_name in array allowed_keys loop
    if p_payload ? field_name and jsonb_typeof(p_payload -> field_name) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'All supplied form values and Meta IDs must be text.';
    end if;
    if length(coalesce(p_payload ->> field_name, '')) > 1000 then
      raise exception using errcode = '22023', message = 'A form value exceeds 1000 characters.';
    end if;
  end loop;
  foreach field_name in array required_keys loop
    if nullif(btrim(p_payload ->> field_name), '') is null then
      raise exception using errcode = '22023', message = 'A required Meta identifier or form answer is missing.';
    end if;
  end loop;
  foreach field_name in array array['meta_lead_id', 'page_id', 'form_id', 'campaign_id', 'adset_id', 'ad_id'] loop
    field_value := p_payload ->> field_name;
    if nullif(field_value, '') is not null and (length(field_value) > 64 or field_value !~ '^[0-9]+$') then
      raise exception using errcode = '22023', message = 'Meta identifiers must contain digits and be supplied as text.';
    end if;
  end loop;

  -- Require an explicit timezone; retain the original string in meta as well.
  if length(p_payload ->> 'submitted_at') > 64
    or (p_payload ->> 'submitted_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception using errcode = '22023', message = 'submitted_at must be an ISO timestamp with a timezone.';
  end if;
  begin
    original_time := (p_payload ->> 'submitted_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'submitted_at is not a valid timestamp.';
  end;

  -- The row lock keeps this transaction's destination/approval stable while an
  -- operator disables or changes a routing entry. No configuration is seeded.
  select s.workspace_id into destination
  from public.meta_lead_intake_sources s
  where s.page_id = p_payload ->> 'page_id'
    and s.form_id = p_payload ->> 'form_id' and s.enabled
  for share;
  if destination is null then
    raise exception using errcode = '42501', message = 'This Page and form are not enabled for intake.';
  end if;

  insert into public.leads (
    workspace_id, meta_lead_id, meta_created_at, name, phone, city, interest,
    custom_fields, source, source_channel, platform, lead_type, currency,
    form_id, form_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    qual_status, journey_status, assigned_to, created_by, consent_whatsapp, consent_email,
    remarks, meta
  ) values (
    destination, p_payload ->> 'meta_lead_id', original_time,
    btrim(p_payload ->> 'full_name'), p_payload ->> 'phone_number', 'Delhi',
    (p_payload ->> 'enquiry_intent') || ' — ' || (p_payload ->> 'property_type'),
    jsonb_build_object(
      'enquiry_intent', p_payload ->> 'enquiry_intent',
      'property_type', p_payload ->> 'property_type',
      'preferred_location', p_payload ->> 'locality',
      'price_or_rent_text', p_payload ->> 'price_or_rent_text'
    ),
    'Meta property enquiry', 'meta', 'meta', 'general', 'INR',
    p_payload ->> 'form_id', coalesce(p_payload ->> 'form_name', ''),
    coalesce(p_payload ->> 'campaign_id', ''), coalesce(p_payload ->> 'campaign_name', ''),
    coalesce(p_payload ->> 'adset_id', ''), coalesce(p_payload ->> 'adset_name', ''),
    coalesce(p_payload ->> 'ad_id', ''), coalesce(p_payload ->> 'ad_name', ''),
    'Not Yet Contacted', 'New Lead', null, null, false, false,
    format(E'Meta property enquiry\nIntent: %s\nProperty type: %s\nLocality: %s\nBudget / expected price / monthly rent: %s',
      p_payload ->> 'enquiry_intent', p_payload ->> 'property_type',
      p_payload ->> 'locality', p_payload ->> 'price_or_rent_text'),
    jsonb_build_object('meta_intake', jsonb_build_object(
      'page_id', p_payload ->> 'page_id', 'form_id', p_payload ->> 'form_id',
      'submitted_at', p_payload ->> 'submitted_at'
    ))
  ) on conflict (workspace_id, meta_lead_id) do nothing
  returning id into saved_id;

  if saved_id is not null then
    created := true;
  else
    -- Deliberately no UPDATE: a retry must not reset sales work, messaging
    -- consent, timestamps, raw answers, or a soft-deleted record.
    select l.id, l.meta -> 'meta_intake' into saved_id, existing_origin
    from public.leads l
    where l.workspace_id = destination and l.meta_lead_id = p_payload ->> 'meta_lead_id';
    if saved_id is null then
      raise exception using errcode = '40001', message = 'The existing submission changed during intake. Retry the request.';
    end if;
    if existing_origin ->> 'page_id' is distinct from p_payload ->> 'page_id'
      or existing_origin ->> 'form_id' is distinct from p_payload ->> 'form_id' then
      raise exception using errcode = '22023', message = 'This Meta lead ID already belongs to a different source.';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'lead_id', saved_id, 'created', created);
end;
$$;
revoke all on function public.ingest_meta_lead(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_meta_lead(jsonb) to service_role;

-- Existing authenticated table grants must not allow a staff client to claim a
-- Meta ID before Make, or change an established ID to defeat deduplication.
create function public.guard_meta_lead_origin() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  ingestion_owner name;
begin
  if tg_op = 'UPDATE' and old.meta_lead_id is not null then
    if new.meta_lead_id is distinct from old.meta_lead_id
      or new.meta_created_at is distinct from old.meta_created_at
      or new.meta -> 'meta_intake' is distinct from old.meta -> 'meta_intake' then
      raise exception using errcode = '42501', message = 'The original Meta submission identity cannot be changed.';
    end if;
  elsif new.meta_lead_id is not null or new.meta_created_at is not null or new.meta ? 'meta_intake' then
    select pg_catalog.pg_get_userbyid(p.proowner) into ingestion_owner
    from pg_catalog.pg_proc p where p.oid = 'public.ingest_meta_lead(jsonb)'::regprocedure;
    if current_user is distinct from ingestion_owner then
      raise exception using errcode = '42501', message = 'Meta submission identity can only be set through trusted intake.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_meta_lead_origin() from public, anon, authenticated, service_role;
create trigger guard_meta_lead_origin before insert or update on public.leads
for each row execute function public.guard_meta_lead_origin();

comment on column public.leads.meta_lead_id is 'Original Meta submission ID, stored as text; unique within the destination workspace.';
comment on column public.leads.meta_created_at is 'Original Meta submission time. created_at remains the CRM receipt time.';
comment on function public.ingest_meta_lead(jsonb) is 'Trusted server-only Meta intake. Workspace comes exclusively from an operator-approved Page/form mapping.';
commit;
