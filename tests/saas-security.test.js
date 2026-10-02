import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const schema = await readFile(new URL('../supabase/saas.sql', import.meta.url), 'utf8')
const ids = {
  ownerA: '00000000-0000-4000-8000-000000000001',
  ownerB: '00000000-0000-4000-8000-000000000002',
  shared: '00000000-0000-4000-8000-000000000003',
  outsider: '00000000-0000-4000-8000-000000000004',
  invitee: '00000000-0000-4000-8000-000000000005',
  unverified: '00000000-0000-4000-8000-000000000006',
  manager: '00000000-0000-4000-8000-000000000007',
  leadA: '10000000-0000-4000-8000-000000000001',
  leadB: '10000000-0000-4000-8000-000000000002',
  noticeA: '20000000-0000-4000-8000-000000000001',
  noticeB: '20000000-0000-4000-8000-000000000002',
}

test('SaaS schema enforces workspace isolation and invitation authorization in PostgreSQL', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
    `)
    await db.exec(schema)
    for (const [key, id] of Object.entries(ids).filter(([key]) => !key.startsWith('lead') && !key.startsWith('notice'))) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)', [
        id, `${key}@example.test`, key === 'unverified' ? null : '2026-09-19T00:00:00Z',
        JSON.stringify({ name: key, role: 'admin', active: true, area_access: ['crm'] }),
      ])
    }
    const asUser = (user, workspace, sql, params = []) => db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.headers',$2,true)", [user, JSON.stringify(workspace ? { 'x-workspace-id': workspace } : {})])
      return tx.query(sql, params)
    })
    const createWorkspace = async (user, name) => (await asUser(user, null, 'select public.create_workspace($1,$2::jsonb) as id', [name, JSON.stringify({ name, countryCode: '1' })])).rows[0].id
    const a = await createWorkspace(ids.ownerA, 'Workspace A')
    const b = await createWorkspace(ids.ownerB, 'Workspace B')
    await db.query(`insert into public.workspace_members(workspace_id,user_id,role) values($1,$3,'coordinator'),($2,$3,'admin'),($1,$4,'sub-admin')`, [a, b, ids.shared, ids.manager])
    await asUser(ids.ownerA, a, 'insert into public.leads(id,name) values($1,$2)', [ids.leadA, 'A private contact'])
    await asUser(ids.ownerB, b, 'insert into public.leads(id,name) values($1,$2)', [ids.leadB, 'B private contact'])
    for (const [workspace, lead, notice] of [[a, ids.leadA, ids.noticeA], [b, ids.leadB, ids.noticeB]]) {
      await db.query('insert into public.notifications(id,workspace_id,lead_id,title) values($1,$2,$3,$4)', [notice, workspace, lead, 'Private notification'])
      await db.query("insert into public.messages(workspace_id,lead_id,channel,body) values($1,$2,'email','Private message')", [workspace, lead])
      await db.query("insert into public.templates(workspace_id,name,channel) values($1,'Private template','email')", [workspace])
      await db.query("insert into public.automations(workspace_id,name) values($1,'Private automation')", [workspace])
      await db.query("insert into public.lead_forms(workspace_id,form_id) values($1,'same-form-id')", [workspace])
      await db.query("insert into public.appointments(workspace_id,lead_id,datetime) values($1,$2,'2026-10-01T12:00:00Z')", [workspace, lead])
      await db.query("insert into public.activities(workspace_id,lead_id,notes) values($1,$2,'Private notes')", [workspace, lead])
    }
    const tenantTables = ['workspace_settings','workspace_members','leads','activities','appointments','templates','automations','messages','notifications','lead_types','lead_forms']

    await t.test('schema detection is public but missing, malformed, or unauthorized workspace selection exposes no business rows', async () => {
      const result = await db.transaction(async (tx) => { await tx.exec('set local role anon'); return tx.query('select public.crm_schema_info() as info') })
      assert.deepEqual(result.rows[0].info, { mode: 'saas', version: 1 })
      for (const table of tenantTables) {
        assert.deepEqual((await asUser(ids.ownerA, null, `select * from public.${table}`)).rows, [], `missing header: ${table}`)
        assert.deepEqual((await asUser(ids.outsider, a, `select * from public.${table}`)).rows, [], `nonmember: ${table}`)
      }
      assert.deepEqual((await asUser(ids.ownerA, 'not-a-uuid', 'select * from public.leads')).rows, [])
      await assert.rejects(asUser(ids.outsider, a, "insert into public.leads(name) values('Unauthorized')"), /row-level security/i)
      await assert.rejects(asUser(ids.ownerA, null, "insert into public.leads(name) values('Unscoped')"), /row-level security|not-null/i)
      await assert.rejects(asUser(ids.outsider, a, 'select * from public.crm_team_profiles()'), /Workspace access/)
      assert.deepEqual((await asUser(ids.outsider, a, 'select * from public.list_my_workspaces()')).rows, [])
      await assert.rejects(asUser(ids.unverified, null, `select public.create_workspace('Unverified','{}')`), /Verify your email/)
    })

    await t.test('membership in multiple workspaces never combines data or roles across the selected workspace', async () => {
      const list = (await asUser(ids.shared, null, 'select * from public.list_my_workspaces()')).rows
      assert.equal(list.length, 2)
      assert.equal(list.find((w) => w.id === a).role, 'coordinator')
      assert.equal(list.find((w) => w.id === b).role, 'admin')
      for (const workspace of [a, b]) {
        for (const table of tenantTables) {
          const rows = (await asUser(ids.shared, workspace, `select * from public.${table}`)).rows
          assert.ok(rows.length > 0, `${table} has fixture rows`)
          assert.ok(rows.every((row) => row.workspace_id === workspace), `${table} is scoped`)
        }
      }
      assert.equal((await asUser(ids.shared, a, 'select public.is_admin() as admin')).rows[0].admin, false)
      assert.equal((await asUser(ids.shared, b, 'select public.is_admin() as admin')).rows[0].admin, true)
      assert.equal((await asUser(ids.shared, a, `update public.workspace_settings set config='{"name":"Forbidden"}' returning workspace_id`)).rows.length, 0)
      assert.equal((await asUser(ids.shared, b, `update public.workspace_settings set config='{"name":"Allowed"}' returning workspace_id`)).rows.length, 1)
      assert.equal((await asUser(ids.shared, null, 'select * from public.list_my_workspaces()')).rows.find((entry) => entry.id === b).name, 'Allowed', 'workspace chooser reflects the saved business name')
      const team = (await asUser(ids.ownerA, a, 'select * from public.crm_team_profiles()')).rows
      assert.ok(!team.some((person) => person.id === ids.ownerB))
      assert.equal(team.find((person) => person.id === ids.shared).role, 'coordinator')
      assert.deepEqual((await asUser(ids.ownerA, a, 'select id from public.profiles')).rows, [{ id: ids.ownerA }])
    })

    await t.test('cross-workspace IDs, parent references, assignees, and tenant moves are rejected', async () => {
      assert.deepEqual((await asUser(ids.shared, a, 'select * from public.leads where id=$1', [ids.leadB])).rows, [])
      await assert.rejects(asUser(ids.shared, a, "insert into public.leads(workspace_id,name) values($1,'Wrong workspace')", [b]), /row-level security/)
      await assert.rejects(asUser(ids.shared, a, 'update public.leads set workspace_id=$1 where id=$2', [b, ids.leadA]), /cannot move between workspaces/)
      await assert.rejects(asUser(ids.shared, a, "insert into public.activities(lead_id,notes) values($1,'Cross-workspace')", [ids.leadB]), /row-level security/)
      await assert.rejects(asUser(ids.shared, a, "insert into public.appointments(lead_id,datetime) values($1,now())", [ids.leadB]), /row-level security/)
      await assert.rejects(asUser(ids.ownerA, a, 'update public.leads set assigned_to=$1 where id=$2', [ids.ownerB, ids.leadA]), /active member of this workspace/)
      // Even trusted integration writes cannot create inconsistent parent links.
      await assert.rejects(db.query("insert into public.messages(workspace_id,lead_id,channel) values($1,$2,'email')", [a, ids.leadB]), /foreign key/)
      await assert.rejects(db.query("insert into public.notifications(workspace_id,lead_id,title) values($1,$2,'Wrong')", [a, ids.leadB]), /foreign key/)
      const templateB = (await db.query('select id from public.templates where workspace_id=$1', [b])).rows[0].id
      await assert.rejects(db.query("insert into public.automations(workspace_id,template_id,name) values($1,$2,'Wrong')", [a, templateB]), /foreign key/)
      await assert.rejects(asUser(ids.ownerA, a, "update public.workspace_members set role='admin' where user_id=$1", [ids.shared]), /permission denied/)
      await assert.rejects(asUser(ids.ownerA, a, "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')", [a, ids.outsider]), /permission denied/)
    })

    await t.test('notification mutations, revisions, and duplicate category/form keys remain workspace scoped', async () => {
      await asUser(ids.shared, a, 'select public.mark_notification_read($1)', [ids.noticeB])
      await asUser(ids.shared, a, 'select public.mark_all_notifications_read()')
      assert.deepEqual((await db.query('select read_by from public.notifications where id=$1', [ids.noticeA])).rows[0].read_by, [ids.shared])
      assert.deepEqual((await db.query('select read_by from public.notifications where id=$1', [ids.noticeB])).rows[0].read_by, [])
      assert.equal(Number((await asUser(ids.shared, a, 'select * from public.crm_leads_revision()')).rows[0].active_count), 1)
      for (const [workspace, user, label] of [[a, ids.ownerA, 'A only'], [b, ids.ownerB, 'B only']]) {
        await asUser(user, workspace, "insert into public.lead_types(key,label) values('same-key',$1) on conflict(workspace_id,key) do update set label=excluded.label", [label])
      }
      assert.equal((await asUser(ids.ownerA, a, "select label from public.lead_types where key='same-key'")).rows[0].label, 'A only')
      assert.equal((await asUser(ids.ownerB, b, "select label from public.lead_types where key='same-key'")).rows[0].label, 'B only')
      await assert.rejects(asUser(ids.outsider, a, 'select public.mark_all_notifications_read()'), /Workspace access/)
    })

    await t.test('invitations are owner-only, contain no retrievable token secret, and require the verified invited identity', async () => {
      await assert.rejects(asUser(ids.manager, a, "select public.create_workspace_invitation('invitee@example.test','coordinator')"), /Only an owner/)
      await assert.rejects(asUser(ids.ownerA, a, "select public.create_workspace_invitation('invitee@example.test','admin')"), /non-owner/)
      const invite = (await asUser(ids.ownerA, a, "select public.create_workspace_invitation('INVITEE@EXAMPLE.TEST','coordinator') as value")).rows[0].value
      assert.equal(invite.email, 'invitee@example.test')
      assert.match(invite.token, /^[a-f0-9]{64}$/)
      assert.equal((await db.query('select octet_length(token_hash) as length from public.workspace_invitations where id=$1', [invite.id])).rows[0].length, 32)
      const list = (await asUser(ids.ownerA, a, 'select * from public.list_workspace_invitations()')).rows
      assert.equal(list.length, 1)
      assert.ok(!Object.hasOwn(list[0], 'token') && !Object.hasOwn(list[0], 'token_hash'))
      await assert.rejects(asUser(ids.ownerA, a, 'select token_hash from public.workspace_invitations'), /permission denied/)
      await assert.rejects(asUser(ids.ownerB, b, 'select public.revoke_workspace_invitation($1)', [invite.id]), /not found in this workspace/)
      await assert.rejects(asUser(ids.outsider, null, 'select public.accept_workspace_invitation($1)', [invite.token]), /email address/)
      await assert.rejects(asUser(ids.unverified, null, 'select public.accept_workspace_invitation($1)', [invite.token]), /Verify your email/)
      assert.equal((await asUser(ids.invitee, b, 'select public.accept_workspace_invitation($1) as workspace', [invite.token])).rows[0].workspace, a)
      await assert.rejects(asUser(ids.invitee, null, 'select public.accept_workspace_invitation($1)', [invite.token]), /invalid or expired/)
      const member = (await asUser(ids.ownerA, a, 'select * from public.crm_team_profiles()')).rows.find((row) => row.id === ids.invitee)
      assert.equal(member.role, 'coordinator')
      assert.equal(member.active, true)
      assert.deepEqual(member.area_access, ['crm'])
      assert.equal(member.password_change_required, false)
    })

    await t.test('revoked, replaced and expired invitations cannot activate membership', async () => {
      const first = (await asUser(ids.ownerA, a, "select public.create_workspace_invitation('outsider@example.test','reception') as value")).rows[0].value
      const replacement = (await asUser(ids.ownerA, a, "select public.create_workspace_invitation('outsider@example.test','marketing') as value")).rows[0].value
      await assert.rejects(asUser(ids.outsider, null, 'select public.accept_workspace_invitation($1)', [first.token]), /invalid or expired/)
      await asUser(ids.ownerA, a, 'select public.revoke_workspace_invitation($1)', [replacement.id])
      await assert.rejects(asUser(ids.outsider, null, 'select public.accept_workspace_invitation($1)', [replacement.token]), /invalid or expired/)
      const expired = (await asUser(ids.ownerA, a, "select public.create_workspace_invitation('outsider@example.test','reception') as value")).rows[0].value
      await db.query("update public.workspace_invitations set expires_at=now()-interval '1 minute' where id=$1", [expired.id])
      await assert.rejects(asUser(ids.outsider, null, 'select public.accept_workspace_invitation($1)', [expired.token]), /invalid or expired/)
      assert.deepEqual((await asUser(ids.outsider, null, 'select * from public.list_my_workspaces()')).rows, [])
    })

    await t.test('membership edits honor tenant roles, versions, self protection, and revocation without global account changes', async () => {
      const update = 'select * from public.update_team_member_access($1,$2,$3,$4,$5::text[],$6)'
      await assert.rejects(asUser(ids.ownerA, a, update, [ids.ownerA, 1, 'coordinator', false, [], 'Self removal']), /Not allowed/)
      await assert.rejects(asUser(ids.manager, a, update, [ids.shared, 1, 'admin', true, ['crm'], 'Promotion']), /Only an owner/)
      await assert.rejects(asUser(ids.ownerA, a, update, [ids.ownerB, 1, 'coordinator', false, [], 'Cross workspace']), /not found/)
      await assert.rejects(asUser(ids.ownerA, a, update, [ids.shared, null, 'reception', true, ['crm'], 'Missing version']), /Membership changed/)
      const changed = (await asUser(ids.manager, a, update, [ids.shared, 1, 'reception', true, ['crm'], 'Role change'])).rows[0]
      assert.equal(changed.access_version, 2)
      assert.equal(changed.role, 'reception')
      await assert.rejects(asUser(ids.ownerA, a, update, [ids.shared, 1, 'coordinator', true, ['crm'], 'Stale version']), /Membership changed/)
      await asUser(ids.ownerA, a, update, [ids.shared, 2, 'reception', false, [], 'Remove from A'])
      assert.deepEqual((await asUser(ids.shared, a, 'select * from public.leads')).rows, [])
      assert.equal((await asUser(ids.shared, b, 'select public.is_admin() as admin')).rows[0].admin, true)
      assert.equal((await db.query('select email from auth.users where id=$1', [ids.shared])).rows[0].email, 'shared@example.test')
      await assert.rejects(asUser(ids.ownerA, a, 'update public.leads set assigned_to=$1 where id=$2', [ids.shared, ids.leadA]), /active member/)
    })

    await t.test('archive and purge permissions preserve tenant ownership and cascade only the selected parent', async () => {
      await assert.rejects(asUser(ids.invitee, a, 'update public.leads set deleted_at=now() where id=$1', [ids.leadA]), /Only owners and managers/)
      await asUser(ids.ownerA, a, 'update public.leads set deleted_at=now() where id=$1', [ids.leadA])
      assert.deepEqual((await asUser(ids.invitee, a, 'select * from public.leads')).rows, [])
      assert.deepEqual((await asUser(ids.invitee, a, 'select * from public.activities')).rows, [])
      assert.equal((await asUser(ids.manager, a, 'delete from public.leads where id=$1 returning id', [ids.leadA])).rows.length, 0)
      await asUser(ids.ownerA, a, 'delete from public.leads where id=$1', [ids.leadA])
      assert.equal((await db.query('select count(*)::int as n from public.activities where workspace_id=$1', [a])).rows[0].n, 0)
      const message = (await db.query('select workspace_id,lead_id from public.messages where workspace_id=$1', [a])).rows[0]
      assert.deepEqual(message, { workspace_id: a, lead_id: null })
      assert.equal((await asUser(ids.ownerB, b, 'select * from public.leads')).rows.length, 1)
    })
  } finally {
    await db.close()
  }
})
