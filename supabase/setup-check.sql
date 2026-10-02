-- Read-only preflight. Run in the intended Supabase project's SQL Editor.
-- This does not install, reset, delete, or modify anything.
begin read only;

select schemaname as schema_name, tablename as table_name
from pg_catalog.pg_tables
where schemaname = 'public'
order by tablename;

select count(*) as existing_auth_accounts from auth.users;

select n.nspname as schema_name, p.proname as function_name
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('crm_schema_info', 'current_workspace_id', 'create_workspace', 'handle_crm_user')
order by p.proname;

commit;
