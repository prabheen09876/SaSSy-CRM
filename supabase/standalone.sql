-- General-purpose CRM: ONE BUSINESS PER SUPABASE PROJECT.
-- Run only in a NEW, empty Supabase project. Never run against an existing system.
-- This file is the complete schema; archive/ is not an installation source.
begin;
create extension if not exists pgcrypto;

-- Public compatibility information only; this reveals no accounts or records.
create function public.crm_schema_info() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"mode":"supabase","version":1}'::jsonb;
$$;
revoke all on function public.crm_schema_info() from public;
grant execute on function public.crm_schema_info() to anon, authenticated;

-- Accounts are inactive until explicitly approved by an owner through the SQL
-- editor or a trusted server. Public signup must never grant business access.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text not null default '',
  role text not null default 'coordinator' check (role in ('admin','sub-admin','coordinator','reception','marketing')),
  active boolean not null default false,
  area_access text[] not null default '{}' check (area_access <@ array['crm']::text[]),
  access_version integer not null default 1 check (access_version > 0),
  password_change_required boolean not null default false,
  created_at timestamptz not null default now()
);
create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and not password_change_required and 'crm' = any(area_access));
$$;
create function public.is_manager() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','sub-admin'));
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create function public.can_manage_templates() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','sub-admin','marketing'));
$$;
create function public.staff_password_change_required() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select password_change_required from public.profiles where id = auth.uid()), false);
$$;
create function public.handle_crm_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, name, email)
  values(new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), coalesce(new.email, ''));
  return new;
end;
$$;
create trigger create_crm_profile after insert on auth.users for each row execute function public.handle_crm_user();

create table public.workspace_settings (
  id text primary key default 'default' check(id = 'default'),
  config jsonb not null default '{}' check(jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings(id, config) values('default', '{}');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) > 0),
  phone text not null default '', email text not null default '', dob date,
  company text not null default '', job_title text not null default '',
  city text not null default '', interest text not null default '',
  website text not null default '', budget numeric(16,2) check(budget >= 0),
  currency text not null default '', expected_close_date date,
  custom_fields jsonb not null default '{}' check(jsonb_typeof(custom_fields) = 'object'),
  source text not null default '', source_channel text not null default '',
  qual_status text not null default 'Not Yet Contacted', journey_status text not null default 'New Lead',
  score integer check(score between 0 and 100), ai_score integer check(ai_score between 0 and 100),
  ai_summary text not null default '',
  followup_date date, followup_time text not null default '',
  assigned_to uuid references public.profiles(id) on delete set null,
  priority text not null default '', remarks text not null default '', manual_rank numeric,
  last_activity timestamptz, last_contacted_at timestamptz,
  consent_whatsapp boolean not null default false, consent_email boolean not null default false,
  lead_type text not null default 'general', platform text not null default '',
  campaign_name text not null default '', campaign_id text not null default '',
  adset_name text not null default '', adset_id text not null default '',
  ad_name text not null default '', ad_id text not null default '',
  form_name text not null default '', form_id text not null default '',
  utm_source text not null default '', utm_medium text not null default '', utm_campaign text not null default '',
  meta jsonb not null default '{}', duplicate_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index leads_active_created on public.leads(created_at desc, id) where deleted_at is null;
create index leads_assigned on public.leads(assigned_to);
create index leads_followup on public.leads(followup_date) where deleted_at is null;

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null default 'Note', notes text not null default '',
  at timestamptz not null default now(), "by" uuid references public.profiles(id) on delete set null default auth.uid()
);
create index activities_lead_at on public.activities(lead_id, at desc);
create index activities_at on public.activities(at desc);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  datetime timestamptz not null,
  type text not null default 'in_person' check(type in ('in_person','virtual','phone','on_site')),
  status text not null default 'booked' check(status in ('booked','confirmed','completed','attended','cancelled','no_show')),
  source text not null default 'staff',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index appointments_datetime on public.appointments(datetime);

create table public.templates (
  id uuid primary key default gen_random_uuid(), name text not null,
  channel text not null check(channel in ('email','whatsapp')), subject text not null default '', body text not null default '',
  category text not null default 'utility', header_type text not null default 'none', header_text text not null default '',
  header_media text not null default '', footer text not null default '', buttons jsonb not null default '[]', cards jsonb not null default '[]',
  provider text, template_key text, language text, status text, quality_status text, rejection_reason text,
  components jsonb not null default '[]', parameter_schema jsonb not null default '[]',
  components_sync_required boolean not null default false, synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- These optional integration stores begin empty. There is no scheduler or
-- provider connection installed by this schema, and no browser send permission.
create table public.automations (
  id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
  trigger text not null default '', channel text not null default 'email',
  template_id uuid references public.templates(id) on delete set null, system_key text,
  enabled boolean not null default false, last_run timestamptz, run_count integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete set null,
  channel text not null, direction text not null default 'out', body text not null default '', subject text not null default '',
  status text not null default 'pending', provider_message_id text, template_key text, template_language text,
  message_type text, media jsonb, context jsonb, error_code text, safe_error text,
  at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete cascade,
  kind text not null default 'lead', title text not null, body text not null default '',
  read_by uuid[] not null default '{}', created_at timestamptz not null default now()
);
create table public.lead_types (
  key text primary key, label text not null, color text not null default 'neutral',
  description text not null default '', default_source text not null default '', sort integer not null default 0, active boolean not null default true
);
insert into public.lead_types(key,label) values('general','General enquiry');
create table public.lead_forms (
  form_id text primary key, form_name text not null default '',
  lead_type text not null default 'general', platform text not null default '',
  active boolean not null default true, config jsonb not null default '{}', created_at timestamptz not null default now()
);

-- Server-side guards apply regardless of browser UI or direct API calls.
create function public.guard_lead_write() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.deleted_at is distinct from old.deleted_at and not public.is_manager() then
      raise exception 'Only owners and managers can archive or restore records.';
    end if;
    if new.created_by is distinct from old.created_by then raise exception 'Record creator cannot be changed.'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_lead_write before insert or update on public.leads for each row execute function public.guard_lead_write();
create function public.guard_appointment_write() returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid();
    elsif new.created_by is distinct from old.created_by then raise exception 'Meeting creator cannot be changed.';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_appointment_write before insert or update on public.appointments for each row execute function public.guard_appointment_write();
create function public.touch_lead_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads set last_activity = greatest(coalesce(last_activity, new.at), new.at), updated_at = now() where id = new.lead_id;
  return new;
end;
$$;
create trigger touch_lead_activity after insert on public.activities for each row execute function public.touch_lead_activity();

alter table public.profiles enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.appointments enable row level security;
alter table public.templates enable row level security;
alter table public.automations enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.lead_types enable row level security;
alter table public.lead_forms enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(id = auth.uid() or public.is_staff());
create policy workspace_read on public.workspace_settings for select to authenticated using(public.is_staff());
create policy workspace_insert on public.workspace_settings for insert to authenticated with check(public.is_manager());
create policy workspace_update on public.workspace_settings for update to authenticated using(public.is_manager()) with check(public.is_manager());
create policy leads_read on public.leads for select to authenticated using(public.is_staff() and (deleted_at is null or public.is_manager()));
create policy leads_insert on public.leads for insert to authenticated with check(public.is_staff() and created_by = auth.uid() and deleted_at is null);
create policy leads_update on public.leads for update to authenticated using(public.is_staff() and (deleted_at is null or public.is_manager())) with check(public.is_staff());
create policy leads_purge on public.leads for delete to authenticated using(public.is_admin() and deleted_at is not null);
create policy activities_read on public.activities for select to authenticated using(public.is_staff() and exists(select 1 from public.leads l where l.id = lead_id));
create policy activities_insert on public.activities for insert to authenticated with check(public.is_staff() and "by" = auth.uid() and exists(select 1 from public.leads l where l.id = lead_id and l.deleted_at is null));
create policy activities_delete on public.activities for delete to authenticated using(public.is_staff() and ("by" = auth.uid() or public.is_manager()) and exists(select 1 from public.leads l where l.id = lead_id));
create policy appointments_read on public.appointments for select to authenticated using(public.is_staff() and exists(select 1 from public.leads l where l.id = lead_id));
create policy appointments_insert on public.appointments for insert to authenticated with check(public.is_staff() and created_by = auth.uid() and exists(select 1 from public.leads l where l.id = lead_id and l.deleted_at is null));
create policy appointments_update on public.appointments for update to authenticated using(public.is_staff()) with check(public.is_staff() and exists(select 1 from public.leads l where l.id = lead_id and l.deleted_at is null));
create policy appointments_delete on public.appointments for delete to authenticated using(public.is_staff() and exists(select 1 from public.leads l where l.id = lead_id));
create policy templates_read on public.templates for select to authenticated using(public.is_staff());
create policy templates_write on public.templates for all to authenticated using(public.can_manage_templates()) with check(public.can_manage_templates());
create policy automations_read on public.automations for select to authenticated using(public.is_staff());
create policy messages_read on public.messages for select to authenticated using(public.is_staff());
create policy notifications_read on public.notifications for select to authenticated using(public.is_staff());
create policy lead_types_read on public.lead_types for select to authenticated using(public.is_staff());
create policy lead_types_write on public.lead_types for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy lead_forms_read on public.lead_forms for select to authenticated using(public.is_staff());
create policy lead_forms_write on public.lead_forms for all to authenticated using(public.is_manager()) with check(public.is_manager());

-- A versioned, limited capability replaces arbitrary profile writes. Owners can
-- manage others; managers can only manage sales/support/marketing staff.
create function public.update_team_member_access(
  p_target_id uuid, p_expected_version integer, p_role text,
  p_active boolean, p_area_access text[], p_reason text
) returns setof public.profiles language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  if not public.is_manager() or p_target_id = auth.uid() then raise exception 'Not allowed to manage this account.'; end if;
  select * into target from public.profiles where id = p_target_id for update;
  if not found then raise exception 'Account not found.'; end if;
  if target.access_version is distinct from p_expected_version then raise exception 'Account changed. Refresh the team before editing.'; end if;
  if p_role not in ('admin','sub-admin','coordinator','reception','marketing') then raise exception 'Invalid role.'; end if;
  if not public.is_admin() and (target.role in ('admin','sub-admin') or p_role in ('admin','sub-admin')) then raise exception 'Only an owner can manage owners or managers.'; end if;
  if p_active is null or p_area_access is null or not p_area_access <@ array['crm']::text[] then raise exception 'Only CRM workspace access is supported.'; end if;
  return query update public.profiles set role = p_role, active = p_active,
    area_access = case when p_active then array['crm']::text[] else '{}'::text[] end,
    access_version = access_version + 1 where id = p_target_id returning *;
end;
$$;
create function public.crm_leads_revision() returns table(active_count bigint, latest_created_at timestamptz, latest_updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select count(*), max(created_at), max(updated_at) from public.leads where deleted_at is null;
$$;
create function public.mark_notification_read(nid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not authorized.'; end if;
  update public.notifications set read_by = array_append(read_by, auth.uid()) where id = nid and not auth.uid() = any(read_by);
end;
$$;
create function public.mark_all_notifications_read() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Not authorized.'; end if;
  update public.notifications set read_by = array_append(read_by, auth.uid()) where not auth.uid() = any(read_by);
end;
$$;

-- Explicit grants: no anonymous data access and no browser provisioning,
-- automation execution, message insertion, or arbitrary profile mutation.
revoke all on public.profiles, public.workspace_settings, public.leads, public.activities, public.appointments,
  public.templates, public.automations, public.messages, public.notifications, public.lead_types, public.lead_forms from anon, authenticated;
grant select on public.profiles, public.automations, public.messages, public.notifications to authenticated;
grant select, insert, update on public.workspace_settings to authenticated;
grant select, insert, update, delete on public.leads, public.appointments, public.templates, public.lead_types, public.lead_forms to authenticated;
grant select, insert, delete on public.activities to authenticated;
grant all on public.profiles, public.workspace_settings, public.leads, public.activities, public.appointments,
  public.templates, public.automations, public.messages, public.notifications, public.lead_types, public.lead_forms to service_role;
revoke all on function public.is_staff(), public.is_manager(), public.is_admin(), public.can_manage_templates(),
  public.staff_password_change_required(), public.handle_crm_user(), public.guard_lead_write(), public.guard_appointment_write(), public.touch_lead_activity(),
  public.update_team_member_access(uuid,integer,text,boolean,text[],text), public.crm_leads_revision(),
  public.mark_notification_read(uuid), public.mark_all_notifications_read() from public, anon;
grant execute on function public.is_staff(), public.is_manager(), public.is_admin(), public.can_manage_templates(),
  public.staff_password_change_required(), public.update_team_member_access(uuid,integer,text,boolean,text[],text),
  public.crm_leads_revision(), public.mark_notification_read(uuid), public.mark_all_notifications_read() to authenticated;
commit;
