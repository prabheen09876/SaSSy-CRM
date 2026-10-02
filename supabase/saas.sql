-- Workspace CRM SaaS: complete schema for a NEW, EMPTY Supabase project.
-- Do not run after standalone.sql or against an existing EPIA installation.
-- The x-workspace-id header selects a workspace, never grants access to it.
begin;

create function public.current_workspace_id() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  return nullif((nullif(current_setting('request.headers', true), '')::jsonb)->>'x-workspace-id', '')::uuid;
exception when invalid_text_representation then return null;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text not null default '',
  created_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','sub-admin','coordinator','reception','marketing')),
  active boolean not null default true,
  access_version integer not null default 1 check (access_version > 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on public.workspace_members(user_id, workspace_id) where active;

-- SECURITY DEFINER avoids recursive membership RLS. Every caller still has to
-- match the selected workspace and a current, database-backed membership.
create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = public.current_workspace_id() and user_id = auth.uid() and active);
$$;
create function public.is_manager() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = public.current_workspace_id() and user_id = auth.uid() and active and role in ('admin','sub-admin'));
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = public.current_workspace_id() and user_id = auth.uid() and active and role = 'admin');
$$;
create function public.can_manage_templates() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = public.current_workspace_id() and user_id = auth.uid() and active and role in ('admin','sub-admin','marketing'));
$$;
create function public.staff_password_change_required() returns boolean language sql stable set search_path = '' as $$ select false; $$;
create function public.crm_schema_info() returns jsonb language sql immutable set search_path = '' as $$ select '{"mode":"saas","version":1}'::jsonb; $$;
create function public.handle_crm_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, name, email)
  values(new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), coalesce(new.email, ''));
  return new;
end;
$$;
create trigger create_crm_profile after insert on auth.users for each row execute function public.handle_crm_user();

create table public.workspace_settings (
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  id text not null default 'default' check (id = 'default'),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now(), primary key (workspace_id, id)
);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('sub-admin','coordinator','reception','marketing')),
  token_hash bytea not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz, accepted_by uuid references public.profiles(id), revoked_at timestamptz,
  created_at timestamptz not null default now(), unique(workspace_id, id)
);
create unique index workspace_invitation_pending_email on public.workspace_invitations(workspace_id, email)
  where accepted_at is null and revoked_at is null;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  name text not null check(length(trim(name)) > 0),
  phone text not null default '', email text not null default '', dob date,
  company text not null default '', job_title text not null default '',
  city text not null default '', interest text not null default '', website text not null default '',
  budget numeric(16,2) check(budget >= 0), currency text not null default '', expected_close_date date,
  custom_fields jsonb not null default '{}' check(jsonb_typeof(custom_fields) = 'object'),
  source text not null default '', source_channel text not null default '',
  qual_status text not null default 'Not Yet Contacted', journey_status text not null default 'New Lead',
  score integer check(score between 0 and 100), ai_score integer check(ai_score between 0 and 100), ai_summary text not null default '',
  followup_date date, followup_time text not null default '', assigned_to uuid,
  priority text not null default '', remarks text not null default '', manual_rank numeric,
  last_activity timestamptz, last_contacted_at timestamptz,
  consent_whatsapp boolean not null default false, consent_email boolean not null default false,
  lead_type text not null default 'general', platform text not null default '',
  campaign_name text not null default '', campaign_id text not null default '', adset_name text not null default '', adset_id text not null default '',
  ad_name text not null default '', ad_id text not null default '', form_name text not null default '', form_id text not null default '',
  utm_source text not null default '', utm_medium text not null default '', utm_campaign text not null default '',
  meta jsonb not null default '{}', duplicate_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(workspace_id, id),
  foreign key(workspace_id, assigned_to) references public.workspace_members(workspace_id, user_id)
);
create index leads_workspace_created on public.leads(workspace_id, created_at desc, id) where deleted_at is null;
create index leads_workspace_assigned on public.leads(workspace_id, assigned_to);
create index leads_workspace_followup on public.leads(workspace_id, followup_date) where deleted_at is null;
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid not null, type text not null default 'Note', notes text not null default '',
  at timestamptz not null default now(), "by" uuid references public.profiles(id) on delete set null default auth.uid(),
  unique(workspace_id, id), foreign key(workspace_id, lead_id) references public.leads(workspace_id, id) on delete cascade
);
create index activities_workspace_lead_at on public.activities(workspace_id, lead_id, at desc);
create index activities_workspace_at on public.activities(workspace_id, at desc);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid not null, datetime timestamptz not null,
  type text not null default 'in_person' check(type in ('in_person','virtual','phone','on_site')),
  status text not null default 'booked' check(status in ('booked','confirmed','completed','attended','cancelled','no_show')),
  source text not null default 'staff', created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), unique(workspace_id, id),
  foreign key(workspace_id, lead_id) references public.leads(workspace_id, id) on delete cascade
);
create index appointments_workspace_datetime on public.appointments(workspace_id, datetime);
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  name text not null, channel text not null check(channel in ('email','whatsapp')), subject text not null default '', body text not null default '',
  category text not null default 'utility', header_type text not null default 'none', header_text text not null default '',
  header_media text not null default '', footer text not null default '', buttons jsonb not null default '[]', cards jsonb not null default '[]',
  provider text, template_key text, language text, status text, quality_status text, rejection_reason text,
  components jsonb not null default '[]', parameter_schema jsonb not null default '[]',
  components_sync_required boolean not null default false, synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id, id)
);
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  name text not null, description text not null default '', trigger text not null default '', channel text not null default 'email',
  template_id uuid, system_key text, enabled boolean not null default false,
  last_run timestamptz, run_count integer not null default 0, created_at timestamptz not null default now(), unique(workspace_id, id),
  foreign key(workspace_id, template_id) references public.templates(workspace_id, id) on delete set null (template_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid, channel text not null, direction text not null default 'out', body text not null default '', subject text not null default '',
  status text not null default 'pending', provider_message_id text, template_key text, template_language text,
  message_type text, media jsonb, context jsonb, error_code text, safe_error text,
  at timestamptz not null default now(), created_at timestamptz not null default now(), unique(workspace_id, id),
  foreign key(workspace_id, lead_id) references public.leads(workspace_id, id) on delete set null (lead_id)
);
create index messages_workspace_at on public.messages(workspace_id, at desc);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  lead_id uuid, kind text not null default 'lead', title text not null, body text not null default '',
  read_by uuid[] not null default '{}', created_at timestamptz not null default now(), unique(workspace_id, id),
  foreign key(workspace_id, lead_id) references public.leads(workspace_id, id) on delete cascade
);
create index notifications_workspace_created on public.notifications(workspace_id, created_at desc);
create table public.lead_types (
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  key text not null, label text not null, color text not null default 'neutral',
  description text not null default '', default_source text not null default '', sort integer not null default 0,
  active boolean not null default true, primary key(workspace_id, key)
);
create table public.lead_forms (
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  form_id text not null, form_name text not null default '', lead_type text not null default 'general', platform text not null default '',
  active boolean not null default true, config jsonb not null default '{}', created_at timestamptz not null default now(),
  primary key(workspace_id, form_id)
);

create function public.guard_workspace_id() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then raise exception 'Records cannot move between workspaces.'; end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['workspace_members','workspace_settings','workspace_invitations','leads','activities','appointments','templates','automations','messages','notifications','lead_types','lead_forms'] loop
    execute format('create trigger immutable_workspace before update on public.%I for each row execute function public.guard_workspace_id()', t);
  end loop;
end $$;
create function public.guard_lead_write() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.deleted_at is distinct from old.deleted_at and not public.is_manager() then raise exception 'Only owners and managers can archive or restore records.'; end if;
      if new.created_by is distinct from old.created_by then raise exception 'Record creator cannot be changed.'; end if;
    end if;
    if new.phone is distinct from old.phone then new.consent_whatsapp := false; end if;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) and not exists(
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.assigned_to and active
  ) then raise exception 'Choose an active member of this workspace.'; end if;
  new.updated_at := now(); return new;
end;
$$;
create trigger guard_lead_write before insert or update on public.leads for each row execute function public.guard_lead_write();
create function public.guard_appointment_write() returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid();
    elsif new.created_by is distinct from old.created_by then raise exception 'Meeting creator cannot be changed.'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_appointment_write before insert or update on public.appointments for each row execute function public.guard_appointment_write();
create function public.touch_lead_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads set last_activity = greatest(coalesce(last_activity, new.at), new.at), updated_at = now()
  where workspace_id = new.workspace_id and id = new.lead_id;
  return new;
end;
$$;
create trigger touch_lead_activity after insert on public.activities for each row execute function public.touch_lead_activity();

do $$ declare t text; begin
  foreach t in array array['profiles','workspaces','workspace_members','workspace_settings','workspace_invitations','leads','activities','appointments','templates','automations','messages','notifications','lead_types','lead_forms'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy profiles_self on public.profiles for select to authenticated using(id = auth.uid());
create policy workspaces_read on public.workspaces for select to authenticated using(id = public.current_workspace_id() and public.is_staff());
create policy members_read on public.workspace_members for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy settings_read on public.workspace_settings for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy settings_insert on public.workspace_settings for insert to authenticated with check(workspace_id = public.current_workspace_id() and public.is_manager());
create policy settings_update on public.workspace_settings for update to authenticated using(workspace_id = public.current_workspace_id() and public.is_manager()) with check(workspace_id = public.current_workspace_id() and public.is_manager());
create policy invitations_read on public.workspace_invitations for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_admin());
create policy leads_read on public.leads for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and (deleted_at is null or public.is_manager()));
create policy leads_insert on public.leads for insert to authenticated with check(workspace_id = public.current_workspace_id() and public.is_staff() and created_by = auth.uid() and deleted_at is null);
create policy leads_update on public.leads for update to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and (deleted_at is null or public.is_manager())) with check(workspace_id = public.current_workspace_id() and public.is_staff());
create policy leads_purge on public.leads for delete to authenticated using(workspace_id = public.current_workspace_id() and public.is_admin() and deleted_at is not null);
create policy activities_read on public.activities for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and exists(select 1 from public.leads l where l.workspace_id = activities.workspace_id and l.id = lead_id));
create policy activities_insert on public.activities for insert to authenticated with check(workspace_id = public.current_workspace_id() and public.is_staff() and "by" = auth.uid() and exists(select 1 from public.leads l where l.workspace_id = activities.workspace_id and l.id = lead_id and l.deleted_at is null));
create policy activities_delete on public.activities for delete to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and ("by" = auth.uid() or public.is_manager()) and exists(select 1 from public.leads l where l.workspace_id = activities.workspace_id and l.id = lead_id));
create policy appointments_read on public.appointments for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and exists(select 1 from public.leads l where l.workspace_id = appointments.workspace_id and l.id = lead_id));
create policy appointments_insert on public.appointments for insert to authenticated with check(workspace_id = public.current_workspace_id() and public.is_staff() and created_by = auth.uid() and exists(select 1 from public.leads l where l.workspace_id = appointments.workspace_id and l.id = lead_id and l.deleted_at is null));
create policy appointments_update on public.appointments for update to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff()) with check(workspace_id = public.current_workspace_id() and public.is_staff() and exists(select 1 from public.leads l where l.workspace_id = appointments.workspace_id and l.id = lead_id and l.deleted_at is null));
create policy appointments_delete on public.appointments for delete to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff() and exists(select 1 from public.leads l where l.workspace_id = appointments.workspace_id and l.id = lead_id));
create policy templates_read on public.templates for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy templates_write on public.templates for all to authenticated using(workspace_id = public.current_workspace_id() and public.can_manage_templates()) with check(workspace_id = public.current_workspace_id() and public.can_manage_templates());
create policy automations_read on public.automations for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy messages_read on public.messages for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy notifications_read on public.notifications for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy lead_types_read on public.lead_types for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy lead_types_write on public.lead_types for all to authenticated using(workspace_id = public.current_workspace_id() and public.is_manager()) with check(workspace_id = public.current_workspace_id() and public.is_manager());
create policy lead_forms_read on public.lead_forms for select to authenticated using(workspace_id = public.current_workspace_id() and public.is_staff());
create policy lead_forms_write on public.lead_forms for all to authenticated using(workspace_id = public.current_workspace_id() and public.is_manager()) with check(workspace_id = public.current_workspace_id() and public.is_manager());

create function public.list_my_workspaces() returns table(id uuid, name text, role text)
language sql stable security definer set search_path = '' as $$
  select w.id, coalesce(nullif(trim(s.config->>'name'),''),w.name), m.role
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  left join public.workspace_settings s on s.workspace_id=w.id and s.id='default'
  where m.user_id = auth.uid() and m.active order by w.created_at, w.id;
$$;
create function public.create_workspace(p_name text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare workspace uuid;
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then raise exception 'Verify your email before creating a workspace.'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 160 then raise exception 'Enter a workspace name of 1 to 160 characters.'; end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then raise exception 'Workspace settings must be an object.'; end if;
  insert into public.workspaces(name, created_by) values(trim(p_name), auth.uid()) returning id into workspace;
  insert into public.workspace_members(workspace_id,user_id,role) values(workspace,auth.uid(),'admin');
  insert into public.workspace_settings(workspace_id,config) values(workspace,p_config || jsonb_build_object('name',trim(p_name)));
  insert into public.lead_types(workspace_id,key,label) values(workspace,'general','General enquiry');
  return workspace;
end;
$$;
create function public.crm_team_profiles() returns table(id uuid,name text,email text,role text,active boolean,area_access text[],access_version integer,password_change_required boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Workspace access is required.'; end if;
  return query select p.id,p.name,p.email,m.role,m.active,case when m.active then array['crm']::text[] else '{}'::text[] end,m.access_version,false
  from public.workspace_members m join public.profiles p on p.id=m.user_id
  where m.workspace_id=public.current_workspace_id() order by p.name,p.id;
end;
$$;
create function public.create_workspace_invitation(p_email text,p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare token text; invitation public.workspace_invitations; email_address text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Only an owner can invite team members.'; end if;
  if p_role is null or p_role not in ('sub-admin','coordinator','reception','marketing') then raise exception 'Choose a non-owner team role.'; end if;
  if email_address is null or length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.'; end if;
  perform 1 from public.workspaces where id=public.current_workspace_id() for update;
  if not public.is_admin() then raise exception 'Only an owner can invite team members.'; end if;
  if exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=public.current_workspace_id() and m.active and lower(u.email)=email_address) then raise exception 'This person already belongs to the workspace.'; end if;
  update public.workspace_invitations set revoked_at=now() where workspace_id=public.current_workspace_id() and email=email_address and accepted_at is null and revoked_at is null;
  token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.workspace_invitations(workspace_id,email,role,token_hash,invited_by)
  values(public.current_workspace_id(),email_address,p_role,sha256(convert_to(token,'UTF8')),auth.uid()) returning * into invitation;
  return jsonb_build_object('id',invitation.id,'token',token,'email',invitation.email,'expires_at',invitation.expires_at);
end;
$$;
create function public.list_workspace_invitations() returns table(id uuid,email text,role text,expires_at timestamptz,accepted_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only an owner can view invitations.'; end if;
  return query select i.id,i.email,i.role,i.expires_at,i.accepted_at,i.revoked_at,i.created_at from public.workspace_invitations i where i.workspace_id=public.current_workspace_id() order by i.created_at desc;
end;
$$;
create function public.revoke_workspace_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only an owner can revoke invitations.'; end if;
  update public.workspace_invitations set revoked_at=now() where id=p_id and workspace_id=public.current_workspace_id() and accepted_at is null and revoked_at is null;
  if not found then raise exception 'Pending invitation not found in this workspace.'; end if;
end;
$$;
create function public.accept_workspace_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.workspace_invitations; verified_email text;
begin
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Verify your email before accepting an invitation.'; end if;
  if p_token is null or length(p_token)<>64 then raise exception 'Invitation is invalid or expired.'; end if;
  select * into invitation from public.workspace_invitations where token_hash=sha256(convert_to(p_token,'UTF8')) for update;
  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation is invalid or expired.'; end if;
  if invitation.email<>verified_email then raise exception 'Sign in with the email address this invitation was sent to.'; end if;
  -- A pending invitation cannot overwrite a role assigned after it was issued.
  insert into public.workspace_members(workspace_id,user_id,role) values(invitation.workspace_id,auth.uid(),invitation.role)
  on conflict(workspace_id,user_id) do update set role=excluded.role,active=true,access_version=public.workspace_members.access_version+1
  where not public.workspace_members.active;
  update public.workspace_invitations set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
  return invitation.workspace_id;
end;
$$;
create function public.update_team_member_access(p_target_id uuid,p_expected_version integer,p_role text,p_active boolean,p_area_access text[],p_reason text)
returns table(id uuid,name text,email text,role text,active boolean,area_access text[],access_version integer,password_change_required boolean)
language plpgsql security definer set search_path = '' as $$
declare target public.workspace_members;
begin
  if not public.is_manager() or p_target_id=auth.uid() then raise exception 'Not allowed to manage this membership.'; end if;
  -- Serialize membership changes, including concurrent owner demotions.
  perform 1 from public.workspaces where workspaces.id=public.current_workspace_id() for update;
  if not public.is_manager() then raise exception 'Not allowed to manage this membership.'; end if;
  select * into target from public.workspace_members m where m.workspace_id=public.current_workspace_id() and m.user_id=p_target_id for update;
  if not found then raise exception 'Workspace member not found.'; end if;
  if target.access_version is distinct from p_expected_version then raise exception 'Membership changed. Refresh the team before editing.'; end if;
  if p_role is null or p_role not in ('admin','sub-admin','coordinator','reception','marketing') then raise exception 'Invalid role.'; end if;
  if not public.is_admin() and (target.role in ('admin','sub-admin') or p_role in ('admin','sub-admin')) then raise exception 'Only an owner can manage owners or managers.'; end if;
  if p_active is null or p_area_access is null or not p_area_access <@ array['crm']::text[] then raise exception 'Only CRM workspace access is supported.'; end if;
  if target.role='admin' and target.active and (p_role<>'admin' or not p_active) and not exists(select 1 from public.workspace_members m where m.workspace_id=target.workspace_id and m.user_id<>target.user_id and m.role='admin' and m.active) then raise exception 'A workspace must retain an active owner.'; end if;
  update public.workspace_members m set role=p_role,active=p_active,access_version=m.access_version+1 where m.workspace_id=target.workspace_id and m.user_id=p_target_id;
  if not p_active then update public.workspace_invitations i set revoked_at=now() where i.workspace_id=target.workspace_id and i.accepted_at is null and i.revoked_at is null and i.email=(select lower(u.email) from auth.users u where u.id=p_target_id); end if;
  return query select p.id,p.name,p.email,m.role,m.active,case when m.active then array['crm']::text[] else '{}'::text[] end,m.access_version,false
  from public.workspace_members m join public.profiles p on p.id=m.user_id where m.workspace_id=target.workspace_id and m.user_id=p_target_id;
end;
$$;
create function public.crm_leads_revision() returns table(active_count bigint,latest_created_at timestamptz,latest_updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select count(*),max(created_at),max(updated_at) from public.leads where workspace_id=public.current_workspace_id() and deleted_at is null;
$$;
create function public.mark_notification_read(nid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Workspace access is required.'; end if;
  update public.notifications set read_by=array_append(read_by,auth.uid()) where workspace_id=public.current_workspace_id() and id=nid and not auth.uid()=any(read_by);
end;
$$;
create function public.mark_all_notifications_read() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Workspace access is required.'; end if;
  update public.notifications set read_by=array_append(read_by,auth.uid()) where workspace_id=public.current_workspace_id() and not auth.uid()=any(read_by);
end;
$$;

-- No browser access to invitation hashes or provider secrets. Business access
-- comes only from workspace_members, never editable auth user metadata.
revoke all on public.profiles,public.workspaces,public.workspace_members,public.workspace_settings,public.workspace_invitations,
  public.leads,public.activities,public.appointments,public.templates,public.automations,public.messages,public.notifications,public.lead_types,public.lead_forms from anon,authenticated;
grant select on public.profiles,public.workspaces,public.workspace_members,public.automations,public.messages,public.notifications to authenticated;
grant select(id,workspace_id,email,role,invited_by,expires_at,accepted_at,accepted_by,revoked_at,created_at) on public.workspace_invitations to authenticated;
grant select,insert,update on public.workspace_settings to authenticated;
grant select,insert,update,delete on public.leads,public.appointments,public.templates,public.lead_types,public.lead_forms to authenticated;
grant select,insert,delete on public.activities to authenticated;
grant all on public.profiles,public.workspaces,public.workspace_members,public.workspace_settings,public.workspace_invitations,
  public.leads,public.activities,public.appointments,public.templates,public.automations,public.messages,public.notifications,public.lead_types,public.lead_forms to service_role;

-- Revoke PostgreSQL's implicit PUBLIC execute on every function created here.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
    'current_workspace_id','is_staff','is_manager','is_admin','can_manage_templates','staff_password_change_required','crm_schema_info','handle_crm_user',
    'guard_workspace_id','guard_lead_write','guard_appointment_write','touch_lead_activity','list_my_workspaces','create_workspace','crm_team_profiles',
    'create_workspace_invitation','list_workspace_invitations','revoke_workspace_invitation','accept_workspace_invitation','update_team_member_access',
    'crm_leads_revision','mark_notification_read','mark_all_notifications_read'
  ]) loop execute format('revoke all on function %s from public, anon, authenticated',f.signature); end loop;
end $$;
grant execute on function public.crm_schema_info() to anon,authenticated;
grant execute on function public.current_workspace_id(),public.is_staff(),public.is_manager(),public.is_admin(),public.can_manage_templates(),
  public.staff_password_change_required(),public.list_my_workspaces(),public.create_workspace(text,jsonb),public.crm_team_profiles(),
  public.create_workspace_invitation(text,text),public.list_workspace_invitations(),public.revoke_workspace_invitation(uuid),public.accept_workspace_invitation(text),
  public.update_team_member_access(uuid,integer,text,boolean,text[],text),public.crm_leads_revision(),public.mark_notification_read(uuid),public.mark_all_notifications_read() to authenticated;
grant execute on all functions in schema public to service_role;
commit;
