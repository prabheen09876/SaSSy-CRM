-- Run only in a disposable PostgreSQL/Supabase database after standalone.sql.
-- Fixtures are rolled back. Any failed assertion aborts the transaction.
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001','owner@test.invalid','{}'),
  ('00000000-0000-4000-8000-000000000002','manager@test.invalid','{}'),
  ('00000000-0000-4000-8000-000000000003','sales@test.invalid','{}'),
  ('00000000-0000-4000-8000-000000000004','signup@test.invalid','{"role":"admin","active":true,"area_access":["crm"]}');
update public.profiles set active = true, area_access = array['crm'], role = case id
  when '00000000-0000-4000-8000-000000000001' then 'admin'
  when '00000000-0000-4000-8000-000000000002' then 'sub-admin'
  else 'coordinator' end
where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
do $$ declare denied boolean := false; begin
  if public.is_staff() then raise exception 'Unapproved signup gained staff access'; end if;
  if exists(select 1 from public.workspace_settings) then raise exception 'Unapproved signup read business settings'; end if;
  begin insert into public.leads(name) values('Unauthorized'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Unapproved signup inserted a lead'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
insert into public.leads(id,name,company,job_title,city,interest,budget,currency,website,expected_close_date,custom_fields)
values('10000000-0000-4000-8000-000000000001','Test customer','Example Ltd','Director','London','Consulting',12500,'GBP','https://example.com','2027-01-15','{"service":"Advisory","quantity":2}');
insert into public.activities(id,lead_id,type,notes) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Meeting','Discovery call');
insert into public.appointments(id,lead_id,datetime,type,status) values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2027-01-15T10:00:00Z','virtual','completed');
do $$ declare denied boolean := false; n integer; begin
  if not exists(select 1 from public.leads where budget=12500 and custom_fields->>'service'='Advisory' and last_activity is not null) then raise exception 'Generic lead fields or activity timestamp were lost'; end if;
  begin update public.profiles set role='admin' where id=auth.uid(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Sales user could self-promote'; end if;
  update public.workspace_settings set config='{"name":"Unauthorized"}'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Sales user changed workspace settings'; end if;
  denied:=false;
  begin update public.leads set deleted_at=now() where id='10000000-0000-4000-8000-000000000001'; exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Sales user archived a lead'; end if;
  denied:=false;
  begin update public.appointments set created_by='00000000-0000-4000-8000-000000000001' where id='30000000-0000-4000-8000-000000000001'; exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Sales user rewrote meeting provenance'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$ declare denied boolean := false; begin
  begin perform public.update_team_member_access('00000000-0000-4000-8000-000000000003',1,'admin',true,array['crm'],'test'); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Manager promoted a staff member to owner'; end if;
  denied:=false;
  begin perform public.update_team_member_access('00000000-0000-4000-8000-000000000003',null,'reception',true,array['crm'],'test'); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Null version bypassed concurrency check'; end if;
  perform public.update_team_member_access('00000000-0000-4000-8000-000000000003',1,'reception',true,array['crm'],'Role change');
  if not exists(select 1 from public.profiles where id='00000000-0000-4000-8000-000000000003' and role='reception' and access_version=2) then raise exception 'Valid role change was not saved'; end if;
  denied:=false;
  begin perform public.update_team_member_access('00000000-0000-4000-8000-000000000001',1,'coordinator',true,array['crm'],'test'); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Manager modified an owner'; end if;
end $$;
update public.workspace_settings set config='{"name":"Example business","customFields":[{"key":"service","label":"Service","type":"text"}]}';
update public.leads set deleted_at=now() where id='10000000-0000-4000-8000-000000000001';
do $$ declare n integer; begin
  delete from public.leads where id='10000000-0000-4000-8000-000000000001'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Manager permanently deleted an archived lead'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$ declare n integer; begin
  if exists(select 1 from public.leads where id='10000000-0000-4000-8000-000000000001') then raise exception 'Staff read archived lead'; end if;
  delete from public.activities where id='20000000-0000-4000-8000-000000000001'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Staff deleted archived lead history'; end if;
  delete from public.appointments where id='30000000-0000-4000-8000-000000000001'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Staff deleted archived meeting'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
do $$ begin
  if not exists(select 1 from public.leads where id='10000000-0000-4000-8000-000000000001') then raise exception 'Owner cannot see archived lead'; end if;
  if not exists(select 1 from public.workspace_settings where config->>'name'='Example business') then raise exception 'Workspace settings did not persist'; end if;
end $$;
update public.leads set deleted_at=null where id='10000000-0000-4000-8000-000000000001';
update public.leads set deleted_at=now() where id='10000000-0000-4000-8000-000000000001';
delete from public.leads where id='10000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from public.leads where id='10000000-0000-4000-8000-000000000001') then raise exception 'Owner purge failed'; end if;
  if exists(select 1 from public.activities where id='20000000-0000-4000-8000-000000000001') then raise exception 'Purge left child activity'; end if;
  perform public.update_team_member_access('00000000-0000-4000-8000-000000000003',2,'reception',false,'{}','Deactivate');
end $$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$ begin
  if public.is_staff() then raise exception 'Deactivated account retained staff access'; end if;
  if exists(select 1 from public.workspace_settings) then raise exception 'Deactivated account read settings'; end if;
end $$;
reset role;
rollback;
