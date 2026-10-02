import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionUrl, normalizeConnection, validatePublicKey, checkConnection, selectedWorkspace, readStoredConnection, CONNECTION_KEY, pendingInvitation, accountSetupPending, connectionIdentity, ACCOUNT_SETUP_KEY } from '../src/lib/connections.js'
import { tenantTable } from '../src/lib/tenant.js'

const key = 'sb_publishable_1234567890abcdefghijklmnop'
const config = { mode: 'saas', supabaseUrl: 'https://project.example.test', publicKey: key, workerUrl: 'https://gateway.example.test' }
const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`

test('connection URLs reject insecure remote hosts and embedded secrets', () => {
  assert.equal(connectionUrl('https://project.example.test/'), 'https://project.example.test')
  assert.equal(connectionUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  for (const url of ['http://remote.example.test', 'https://user:secret@host.test', 'https://host.test?token=secret', 'https://host.test/#secret', 'https://host.test/path', 'javascript:alert(1)']) assert.throws(() => connectionUrl(url))
})

test('only public Supabase keys are accepted and private values never survive normalization', () => {
  assert.equal(validatePublicKey(key), key)
  assert.equal(validatePublicKey(jwt('anon')), jwt('anon'))
  for (const secret of ['sb_secret_private', jwt('service_role'), jwt('authenticated'), 'postgres://secret', 'random-cloudflare-token']) assert.throws(() => validatePublicKey(secret))
  assert.deepEqual(normalizeConnection({ ...config, password: 'not-persisted', token: 'not-persisted' }), config)
  assert.deepEqual(normalizeConnection({ ...config, mode: 'demo' }), { mode: 'demo', supabaseUrl: '', publicKey: '', workerUrl: '' })
})

test('connection testing checks SaaS schema and gateway without sending a current user session', async () => {
  const calls = []
  const result = await checkConnection(config, async (url, options) => {
    calls.push([url, options])
    return Response.json(url.endsWith('crm_schema_info') ? { mode: 'saas', version: 1 } : url.endsWith('/public/health') ? { ok: true, service: 'workspace-crm', version: 1 } : {})
  })
  assert.deepEqual(result, { database: 'reachable', gateway: 'reachable' })
  assert.equal(calls.length, 3)
  for (const [, options] of calls) { assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers?.authorization, undefined) }
  assert.equal(calls[2][1].headers, undefined)
  await assert.rejects(checkConnection(config, async () => Response.json({})), /schema is missing/)
  await assert.rejects(checkConnection(config, async (url) => Response.json(url.endsWith('crm_schema_info') ? { mode: 'saas', version: 1 } : {})), /gateway health/)
})

test('standalone setup verifies its schema instead of accepting an empty reachable database', async () => {
  const standalone = { ...config, mode: 'supabase', workerUrl: '' }
  const calls = []
  assert.deepEqual(await checkConnection(standalone, async (url, options) => {
    calls.push([url, options])
    return Response.json(url.endsWith('crm_schema_info') ? { mode: 'supabase', version: 1 } : {})
  }), { database: 'reachable', gateway: 'not configured' })
  assert.equal(calls.length, 2)
  assert.ok(calls[1][0].endsWith('/rest/v1/rpc/crm_schema_info'))
  assert.equal(calls[1][1].headers.authorization, undefined)
  await assert.rejects(checkConnection(standalone, async (url) => Response.json({}, { status: url.endsWith('crm_schema_info') ? 404 : 200 })), /standalone CRM schema is missing.*standalone\.sql/)
  await assert.rejects(checkConnection(config, async (url) => Response.json({}, { status: url.endsWith('crm_schema_info') ? 404 : 200 })), /SaaS CRM schema is missing.*saas\.sql/)
  await assert.rejects(checkConnection(standalone, async (url) => Response.json(url.endsWith('crm_schema_info') ? { mode: 'saas', version: 1 } : {})), /Choose SaaS.*Do not install another schema/)
  await assert.rejects(checkConnection(config, async (url) => Response.json(url.endsWith('crm_schema_info') ? { mode: 'supabase', version: 1 } : {})), /Choose Standalone.*Do not install another schema/)
})

test('the account-creation handoff applies only to the newly connected SaaS project', () => {
  const storage = { getItem: (key) => key === ACCOUNT_SETUP_KEY ? JSON.stringify({ project: connectionIdentity(config) }) : null }
  assert.equal(accountSetupPending(config, storage), true)
  assert.equal(accountSetupPending({ ...config, supabaseUrl: 'https://another.example.test' }, storage), false)
  assert.equal(accountSetupPending({ ...config, mode: 'supabase' }, storage), false)
  assert.equal(accountSetupPending(config, { getItem: () => 'invalid' }), false)
  assert.equal(accountSetupPending(config, { getItem: () => null }), false)
})

test('malformed browser configuration and invalid workspace selections fail closed', () => {
  assert.equal(readStoredConnection({ getItem: () => 'not-json' }), null)
  assert.equal(readStoredConnection({ getItem: () => JSON.stringify({ ...config, publicKey: 'sb_secret_wrong' }) }), null)
  assert.deepEqual(readStoredConnection({ getItem: (k) => k === CONNECTION_KEY ? JSON.stringify(config) : null }), config)
  assert.equal(selectedWorkspace({ getItem: () => JSON.stringify({ id: 'bad-id' }) }), null)
})

test('tenant query adapter scopes reads and writes and rejects moving records', () => {
  const calls = []
  const query = new Proxy({}, { get: (_, method) => (...args) => { calls.push([method, ...args]); return query } })
  const client = { from: (table) => { calls.push(['from', table]); return query } }
  assert.throws(() => tenantTable(client, 'leads', null), /Choose a workspace/)
  const table = tenantTable(client, 'leads', 'workspace-a')
  table.select('*'); table.update({ name: 'Maya' }); table.delete()
  assert.equal(calls.filter(([method, column, value]) => method === 'eq' && column === 'workspace_id' && value === 'workspace-a').length, 3)
  table.insert([{ name: 'Maya' }])
  assert.deepEqual(calls.find(([method]) => method === 'insert')[1], [{ name: 'Maya', workspace_id: 'workspace-a' }])
  table.upsert({ key: 'general' }, { onConflict: 'key' })
  assert.deepEqual(calls.find(([method]) => method === 'upsert')[2], { onConflict: 'workspace_id,key' })
  assert.throws(() => table.insert({ workspace_id: 'workspace-b' }), /cannot be moved/)
  assert.throws(() => table.update({ workspace_id: 'workspace-a' }), /cannot be moved/)
})

test('pending invitations cannot be carried into another database connection', () => {
  const token = 'a'.repeat(64)
  const storage = { getItem: () => JSON.stringify({ project: 'project-a', token }) }
  assert.equal(pendingInvitation('project-a', storage), token)
  assert.equal(pendingInvitation('project-b', storage), '')
  assert.equal(pendingInvitation('project-a', { getItem: () => token }), '')
  assert.equal(pendingInvitation('project-a', { getItem: () => JSON.stringify({ project: 'project-a', token: 'invalid' }) }), '')
})
