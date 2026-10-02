import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

test('standalone schema can be identified without exposing data or creating an owner', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
    `)
    await db.exec(await readFile(new URL('../supabase/standalone.sql', import.meta.url), 'utf8'))
    const result = await db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      return tx.query('select public.crm_schema_info() as info')
    })
    assert.deepEqual(result.rows[0].info, { mode: 'supabase', version: 1 })
    for (const table of ['profiles', 'leads', 'workspace_settings']) {
      await assert.rejects(db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        return tx.query(`select * from public.${table}`)
      }), /permission denied/)
    }
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 0)
    const user = '00000000-0000-4000-8000-000000000001'
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      user, 'setup@example.test', JSON.stringify({ role: 'admin', active: true }),
    ])
    const profile = (await db.query('select role,active,area_access from public.profiles where id=$1', [user])).rows[0]
    assert.deepEqual(profile, { role: 'coordinator', active: false, area_access: [] })
    const access = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user])
      return tx.query('select public.is_admin() as admin, public.is_staff() as staff')
    })
    assert.deepEqual(access.rows[0], { admin: false, staff: false })
    await db.exec(await readFile(new URL('../supabase/setup-check.sql', import.meta.url), 'utf8'))
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 1)
  } finally {
    await db.close()
  }
})
