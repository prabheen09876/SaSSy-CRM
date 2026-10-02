-- Additive follow-up to 20260924_meta_lead_ingestion.sql.
-- Existing Page/form routes keep the full questionnaire requirements.
-- No sources are enabled here: opt a newly approved form into 'short' separately.
begin;

alter table public.meta_lead_intake_sources
  add column form_variant text not null default 'full'
  constraint meta_lead_intake_sources_form_variant_check check (form_variant in ('full', 'short'));

comment on column public.meta_lead_intake_sources.form_variant is
  'Operator-only validation choice: full requires property type, locality and price/rent; short requires name, phone and enquiry intent only.';

create or replace function public.ingest_meta_lead(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  allowed_keys constant text[] := array[
    'meta_lead_id', 'page_id', 'form_id', 'submitted_at', 'full_name', 'phone_number',
    'enquiry_intent', 'property_type', 'locality', 'price_or_rent_text',
    'form_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'
  ];
  required_keys constant text[] := array[
    'meta_lead_id', 'page_id', 'form_id', 'submitted_at', 'full_name', 'phone_number',
    'enquiry_intent'
  ];
  field_name text;
  field_value text;
  destination uuid;
  source_variant text;
  property_answer text;
  locality_answer text;
  price_answer text;
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

  if length(p_payload ->> 'submitted_at') > 64
    or (p_payload ->> 'submitted_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception using errcode = '22023', message = 'submitted_at must be an ISO timestamp with a timezone.';
  end if;
  begin
    original_time := (p_payload ->> 'submitted_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'submitted_at is not a valid timestamp.';
  end;

  -- Both destination and questionnaire requirements come from this approved
  -- route, never from the incoming payload. The lock keeps them stable together.
  select s.workspace_id, s.form_variant into destination, source_variant
  from public.meta_lead_intake_sources s
  where s.page_id = p_payload ->> 'page_id'
    and s.form_id = p_payload ->> 'form_id' and s.enabled
  for share;
  if destination is null then
    raise exception using errcode = '42501', message = 'This Page and form are not enabled for intake.';
  end if;
  if source_variant = 'full' then
    foreach field_name in array array['property_type', 'locality', 'price_or_rent_text'] loop
      if nullif(btrim(p_payload ->> field_name), '') is null then
        raise exception using errcode = '22023', message = 'A required Meta identifier or form answer is missing.';
      end if;
    end loop;
  end if;

  -- Keep supplied answers verbatim. Missing/blank optional short-form fields
  -- stay absent instead of fabricating a property type, locality or budget.
  property_answer := case when nullif(btrim(p_payload ->> 'property_type'), '') is not null then p_payload ->> 'property_type' end;
  locality_answer := case when nullif(btrim(p_payload ->> 'locality'), '') is not null then p_payload ->> 'locality' end;
  price_answer := case when nullif(btrim(p_payload ->> 'price_or_rent_text'), '') is not null then p_payload ->> 'price_or_rent_text' end;

  insert into public.leads (
    workspace_id, meta_lead_id, meta_created_at, name, phone, city, interest,
    custom_fields, source, source_channel, platform, lead_type, currency,
    form_id, form_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    qual_status, journey_status, assigned_to, created_by, consent_whatsapp, consent_email,
    remarks, meta
  ) values (
    destination, p_payload ->> 'meta_lead_id', original_time,
    btrim(p_payload ->> 'full_name'), p_payload ->> 'phone_number', 'Delhi',
    concat_ws(' — ', p_payload ->> 'enquiry_intent', property_answer),
    jsonb_strip_nulls(jsonb_build_object(
      'enquiry_intent', p_payload ->> 'enquiry_intent',
      'property_type', property_answer,
      'preferred_location', locality_answer,
      'price_or_rent_text', price_answer
    )),
    'Meta property enquiry', 'meta', 'meta', 'general', 'INR',
    p_payload ->> 'form_id', coalesce(p_payload ->> 'form_name', ''),
    coalesce(p_payload ->> 'campaign_id', ''), coalesce(p_payload ->> 'campaign_name', ''),
    coalesce(p_payload ->> 'adset_id', ''), coalesce(p_payload ->> 'adset_name', ''),
    coalesce(p_payload ->> 'ad_id', ''), coalesce(p_payload ->> 'ad_name', ''),
    'Not Yet Contacted', 'New Lead', null, null, false, false,
    concat_ws(E'\n', 'Meta property enquiry', 'Intent: ' || (p_payload ->> 'enquiry_intent'),
      'Property type: ' || property_answer, 'Locality: ' || locality_answer,
      'Budget / expected price / monthly rent: ' || price_answer),
    jsonb_build_object('meta_intake', jsonb_build_object(
      'page_id', p_payload ->> 'page_id', 'form_id', p_payload ->> 'form_id',
      'submitted_at', p_payload ->> 'submitted_at'
    ))
  ) on conflict (workspace_id, meta_lead_id) do nothing
  returning id into saved_id;

  if saved_id is not null then
    created := true;
  else
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
commit;
