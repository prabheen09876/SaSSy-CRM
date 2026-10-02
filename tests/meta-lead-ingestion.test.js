import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const schema = await readFile(new URL('../supabase/saas.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/20260924_meta_lead_ingestion.sql', import.meta.url), 'utf8')
const shortFormMigration = await readFile(new URL('../supabase/migrations/20260925_meta_short_form_intake.sql', import.meta.url), 'utf8')

test('Meta intake preserves enquiries, sales work, and workspace isolation', async (t) => {
  const db = new PGlite()
  const ownerA = '00000000-0000-4000-8000-000000000001'
  const ownerB = '00000000-0000-4000-8000-000000000002'
  const payload = {
    meta_lead_id: '9999999999999999999', page_id: '123', form_id: '456',
    submitted_at: '2026-09-24T10:30:00+05:30', full_name: ' Test Enquiry ',
    phone_number: '+91 00000 00000', enquiry_intent: 'Rent a property',
    property_type: 'Residential', locality: 'Delhi test locality',
    price_or_rent_text: 'INR 25,000–35,000 per month', form_name: 'Local test form',
  }
  const asRole = (role, sql, params = [], user = '', workspace = '') => db.transaction(async (tx) => {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role))
    await tx.exec(`set local role ${role}`)
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.headers',$2,true)",
      [user, JSON.stringify(workspace ? { 'x-workspace-id': workspace } : {})])
    return tx.query(sql, params)
  })
  const intake = (data = payload) => asRole('service_role', 'select public.ingest_meta_lead($1::jsonb) as result', [JSON.stringify(data)])
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
    `)
    await db.exec(schema)
    await db.exec(migration)
    await db.exec(shortFormMigration)
    for (const [id, name] of [[ownerA, 'Owner A'], [ownerB, 'Owner B']]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)',
        [id, `${id}@example.test`, JSON.stringify({ name })])
    }
    const a = (await asRole('authenticated', "select public.create_workspace('Test A','{}') as id", [], ownerA)).rows[0].id
    const b = (await asRole('authenticated', "select public.create_workspace('Test B','{}') as id", [], ownerB)).rows[0].id
    await db.query("insert into public.meta_lead_intake_sources(page_id,form_id,workspace_id) values('123','456',$1)", [a])
    let leadId

    await t.test('only the trusted integration can ingest, and routing starts disabled', async () => {
      for (const role of ['anon', 'authenticated']) {
        await assert.rejects(asRole(role, 'select public.ingest_meta_lead($1::jsonb)', [JSON.stringify(payload)], ownerA, a), /permission denied/)
      }
      await assert.rejects(asRole('service_role', 'select * from public.meta_lead_intake_sources'), /permission denied/)
      await assert.rejects(intake(), /not enabled/)
      await db.exec("update public.meta_lead_intake_sources set enabled=true where page_id='123' and form_id='456'")
    })

    await t.test('creates one enquiry with raw budget, text IDs, separate times, and no messaging consent', async () => {
      const result = (await intake()).rows[0].result
      assert.equal(result.created, true)
      leadId = result.lead_id
      const row = (await db.query('select * from public.leads where id=$1', [leadId])).rows[0]
      assert.equal(row.workspace_id, a)
      assert.equal(row.meta_lead_id, payload.meta_lead_id)
      assert.equal(new Date(row.meta_created_at).toISOString(), '2026-09-24T05:00:00.000Z')
      assert.equal(row.meta.meta_intake.submitted_at, payload.submitted_at)
      assert.equal(row.name, 'Test Enquiry')
      assert.equal(row.phone, payload.phone_number)
      assert.equal(row.custom_fields.price_or_rent_text, payload.price_or_rent_text)
      assert.equal(row.budget, null)
      assert.equal(row.consent_whatsapp, false)
      assert.equal(row.consent_email, false)
      assert.equal(row.journey_status, 'New Lead')
      assert.equal(row.created_by, null)
      assert.equal((await db.query('select count(*)::int as n from public.messages')).rows[0].n, 0)
    })

    await t.test('a repeated submission does not overwrite staff edits or resurrect deleted records', async () => {
      await asRole('authenticated', "update public.leads set journey_status='Follow-up',remarks='Salesperson notes',assigned_to=$1,consent_email=true where id=$2", [ownerA, leadId], ownerA, a)
      const before = (await db.query('select * from public.leads where id=$1', [leadId])).rows[0]
      assert.deepEqual((await intake({ ...payload, full_name: 'Changed retry', price_or_rent_text: 'Different answer' })).rows[0].result,
        { ok: true, lead_id: leadId, created: false })
      assert.deepEqual((await db.query('select * from public.leads where id=$1', [leadId])).rows[0], before)
      await asRole('authenticated', 'update public.leads set deleted_at=now() where id=$1', [leadId], ownerA, a)
      await intake()
      assert.ok((await db.query('select deleted_at from public.leads where id=$1', [leadId])).rows[0].deleted_at)
    })

    await t.test('new submission from the same phone is separate and stays in its approved workspace', async () => {
      const second = (await intake({ ...payload, meta_lead_id: '9999999999999999998' })).rows[0].result
      assert.notEqual(second.lead_id, leadId)
      assert.equal(second.created, true)
      assert.equal((await db.query('select count(*)::int as n from public.leads')).rows[0].n, 2)
      assert.deepEqual((await asRole('authenticated', 'select id from public.leads', [], ownerB, b)).rows, [])
      assert.equal((await asRole('authenticated', 'select id from public.leads where deleted_at is null', [], ownerA, a)).rows.length, 1)
    })

    await t.test('rejects unapproved sources, workspace injection, invalid fields, and identity tampering', async () => {
      const invalid = [
        { ...payload, page_id: '124' }, { ...payload, workspace_id: b },
        { ...payload, full_name: ' ' }, { ...payload, meta_lead_id: 123 },
        { ...payload, submitted_at: 'not-a-date' }, { ...payload, consent_whatsapp: true },
      ]
      for (const data of invalid) await assert.rejects(intake(data))
      await db.query("insert into public.meta_lead_intake_sources(page_id,form_id,workspace_id,enabled) values('123','457',$1,true)", [a])
      await assert.rejects(intake({ ...payload, form_id: '457' }), /different source/)
      await assert.rejects(asRole('authenticated', "update public.leads set meta_lead_id='555' where id=$1", [leadId], ownerA, a), /cannot be changed/)
      await assert.rejects(asRole('authenticated', "insert into public.leads(name,meta_lead_id,meta_created_at) values('Forged','444',now())", [], ownerA, a), /trusted intake/)
      assert.equal((await db.query('select count(*)::int as n from public.leads')).rows[0].n, 2)
    })

    await t.test('existing full routes still require all qualification answers after the additive migration', async () => {
      const route = (await db.query("select form_variant from public.meta_lead_intake_sources where page_id='123' and form_id='456'")).rows[0]
      assert.equal(route.form_variant, 'full')
      for (const field of ['property_type', 'locality', 'price_or_rent_text']) {
        for (const value of [undefined, null, '', '  ']) {
          await assert.rejects(intake({ ...payload, [field]: value }), /required Meta identifier or form answer is missing/)
        }
      }
      await assert.rejects(intake({ ...payload, form_variant: 'short' }), /unsupported field/)
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await assert.rejects(asRole(role, "update public.meta_lead_intake_sources set form_variant='short' where form_id='456'", [], ownerA, a), /permission denied/)
      }
      await assert.rejects(db.query("insert into public.meta_lead_intake_sources(page_id,form_id,workspace_id,form_variant) values('123','458',$1,'anything')", [a]), /form_variant_check/)
    })

    const shortPayload = {
      meta_lead_id: '9999999999999999901', page_id: '123', form_id: '459',
      submitted_at: '2026-09-25T10:30:00+05:30', full_name: ' Short Form Enquiry ',
      phone_number: '+91 00000 00000', enquiry_intent: 'Buy a property',
      form_name: 'Short test form',
    }
    let shortLeadId
    await t.test('approved short routes save only provided answers and remain disabled until enabled', async () => {
      await db.query("insert into public.meta_lead_intake_sources(page_id,form_id,workspace_id,form_variant) values('123','459',$1,'short')", [a])
      await assert.rejects(intake(shortPayload), /not enabled/)
      await db.exec("update public.meta_lead_intake_sources set enabled=true where page_id='123' and form_id='459'")
      const result = (await intake(shortPayload)).rows[0].result
      assert.equal(result.created, true)
      shortLeadId = result.lead_id
      const row = (await db.query('select * from public.leads where id=$1', [shortLeadId])).rows[0]
      assert.equal(row.workspace_id, a)
      assert.equal(row.form_id, shortPayload.form_id)
      assert.equal(row.name, 'Short Form Enquiry')
      assert.equal(row.phone, shortPayload.phone_number)
      assert.equal(row.interest, shortPayload.enquiry_intent)
      assert.deepEqual(row.custom_fields, { enquiry_intent: shortPayload.enquiry_intent })
      assert.equal(row.remarks, 'Meta property enquiry\nIntent: Buy a property')
      assert.equal(row.budget, null)
      assert.equal(row.consent_whatsapp, false)
      assert.equal(row.consent_email, false)
      assert.equal(row.journey_status, 'New Lead')
      assert.deepEqual((await asRole('authenticated', 'select id from public.leads', [], ownerB, b)).rows, [])
    })

    await t.test('blank Make mappings are absent while optional answers are preserved verbatim', async () => {
      const emptyResult = (await intake({
        ...shortPayload, meta_lead_id: '9999999999999999902',
        property_type: null, locality: '', price_or_rent_text: '  ',
      })).rows[0].result
      const emptyRow = (await db.query('select interest,custom_fields,remarks from public.leads where id=$1', [emptyResult.lead_id])).rows[0]
      assert.deepEqual(emptyRow, {
        interest: 'Buy a property', custom_fields: { enquiry_intent: 'Buy a property' },
        remarks: 'Meta property enquiry\nIntent: Buy a property',
      })
      const answeredResult = (await intake({
        ...payload, form_id: shortPayload.form_id, meta_lead_id: '9999999999999999903',
      })).rows[0].result
      const row = (await db.query('select interest,custom_fields,remarks from public.leads where id=$1', [answeredResult.lead_id])).rows[0]
      assert.equal(row.interest, 'Rent a property — Residential')
      assert.deepEqual(row.custom_fields, {
        enquiry_intent: payload.enquiry_intent, property_type: payload.property_type,
        preferred_location: payload.locality, price_or_rent_text: payload.price_or_rent_text,
      })
      assert.equal(row.remarks, `Meta property enquiry\nIntent: ${payload.enquiry_intent}\nProperty type: ${payload.property_type}\nLocality: ${payload.locality}\nBudget / expected price / monthly rent: ${payload.price_or_rent_text}`)
    })

    await t.test('short intake still rejects missing identity, malformed answers and source reassignment', async () => {
      for (const field of ['meta_lead_id', 'page_id', 'form_id', 'submitted_at', 'full_name', 'phone_number', 'enquiry_intent']) {
        await assert.rejects(intake({ ...shortPayload, [field]: undefined }), /required Meta identifier or form answer is missing/)
      }
      for (const data of [
        { ...shortPayload, property_type: ['Residential'] },
        { ...shortPayload, price_or_rent_text: 25000 },
        { ...shortPayload, enquiry_intent: ' ' },
        { ...shortPayload, page_id: '124' },
        { ...shortPayload, workspace_id: b },
      ]) await assert.rejects(intake(data))
      await assert.rejects(intake({ ...shortPayload, meta_lead_id: payload.meta_lead_id }), /different source/)
    })

    await t.test('short form retries preserve later qualification by the sales team', async () => {
      await asRole('authenticated', "update public.leads set journey_status='Follow-up',remarks='Qualified by phone',custom_fields=$1::jsonb where id=$2",
        [JSON.stringify({ enquiry_intent: 'Buy a property', property_type: 'Residential', preferred_location: 'Dwarka' }), shortLeadId], ownerA, a)
      const before = (await db.query('select * from public.leads where id=$1', [shortLeadId])).rows[0]
      assert.deepEqual((await intake({ ...shortPayload, full_name: 'Changed retry' })).rows[0].result,
        { ok: true, lead_id: shortLeadId, created: false })
      assert.deepEqual((await db.query('select * from public.leads where id=$1', [shortLeadId])).rows[0], before)
    })
  } finally {
    await db.close()
  }
})
