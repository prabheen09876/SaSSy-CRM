import test from 'node:test'
import assert from 'node:assert/strict'
import { handleGateway } from '../cloudflare/src/index.js'

const workspace = '11111111-1111-4111-8111-111111111111'
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = {
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_PUBLIC_KEY: 'sb_publishable_test_public_key',
  ALLOWED_ORIGINS: 'https://crm.example.test',
  ALLOW_LOCALHOST: 'false',
}
const authorized = { Origin: 'https://crm.example.test', Authorization: 'Bearer test-user-token', 'x-workspace-id': workspace }
const request = (path = '/health', headers = authorized, method = 'GET') => new Request(`https://gateway.example.test${path}`, { method, headers })
const mustNotFetch = async () => { assert.fail('Unexpected upstream request') }
const userResponse = () => Response.json({ id: userId })

test('public health exposes only the service marker, without credentials or database checks', async () => {
  const response = await handleGateway(request('/public/health', {}), {}, mustNotFetch)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: 'workspace-crm', version: 1 })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
})

test('gateway rejects an unlisted origin before making any upstream request', async () => {
  const response = await handleGateway(request('/health', { ...authorized, Origin: 'https://crm.example.test.attacker.test' }), env, mustNotFetch)
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.deepEqual(await response.json(), { ok: false, error: 'origin_not_allowed' })
})

test('preflight only allows known origins, routes, methods, and headers', async () => {
  const headers = { Origin: env.ALLOWED_ORIGINS, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization, X-Workspace-Id' }
  const accepted = await handleGateway(request('/health', headers, 'OPTIONS'), env, mustNotFetch)
  assert.equal(accepted.status, 204)
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGINS)
  assert.equal(accepted.headers.get('Access-Control-Allow-Credentials'), null)
  assert.equal((await handleGateway(request('/health', { ...headers, 'Access-Control-Request-Method': 'POST' }, 'OPTIONS'), env, mustNotFetch)).status, 403)
  assert.equal((await handleGateway(request('/health', { ...headers, 'Access-Control-Request-Headers': 'x-admin-key' }, 'OPTIONS'), env, mustNotFetch)).status, 403)
  assert.equal((await handleGateway(request('/unknown', headers, 'OPTIONS'), env, mustNotFetch)).status, 404)
})

test('authenticated health requires a bearer token and a valid workspace ID', async () => {
  assert.equal((await handleGateway(request('/health', { Origin: env.ALLOWED_ORIGINS }), env, mustNotFetch)).status, 401)
  assert.equal((await handleGateway(request('/health', { ...authorized, Authorization: 'Basic abc' }), env, mustNotFetch)).status, 401)
  assert.equal((await handleGateway(request('/health', { ...authorized, 'x-workspace-id': '' }), env, mustNotFetch)).status, 400)
  assert.equal((await handleGateway(request('/health', { ...authorized, 'x-workspace-id': `${workspace},${workspace}` }), env, mustNotFetch)).status, 400)
})

test('configuration fails closed for elevated keys, malformed URLs, and wildcard CORS', async () => {
  const elevatedJwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
  for (const invalid of [
    { SUPABASE_PUBLIC_KEY: '' },
    { SUPABASE_PUBLIC_KEY: 'sb_secret_never_use_this' },
    { SUPABASE_PUBLIC_KEY: elevatedJwt },
    { SUPABASE_URL: 'http://database.example.test' },
    { SUPABASE_URL: 'https://user:password@database.example.test' },
    { SUPABASE_URL: 'https://database.example.test/arbitrary/path' },
    { SUPABASE_URL: 'https://database.example.test?token=secret' },
    { ALLOWED_ORIGINS: '*' },
  ]) {
    const response = await handleGateway(request(), { ...env, ...invalid }, mustNotFetch)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, error: 'gateway_not_configured' })
  }
})

test('local HTTP origins and Supabase require an explicit local-development setting', async () => {
  const local = { ...env, SUPABASE_URL: 'http://127.0.0.1:54321', ALLOWED_ORIGINS: 'http://localhost:5178' }
  const localRequest = request('/health', { ...authorized, Origin: local.ALLOWED_ORIGINS })
  assert.equal((await handleGateway(localRequest, local, mustNotFetch)).status, 503)
  let calls = 0
  const response = await handleGateway(localRequest, { ...local, ALLOW_LOCALHOST: 'true' }, async () => ++calls === 1 ? userResponse() : Response.json(true))
  assert.equal(response.status, 200)
  assert.equal(calls, 2)
})

test('a Supabase authentication rejection never reaches the workspace RPC', async () => {
  let calls = 0
  const response = await handleGateway(request(), env, async () => {
    calls++
    return Response.json({ secretDiagnostic: 'must not be returned' }, { status: 401 })
  })
  assert.equal(calls, 1)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer')
  assert.deepEqual(await response.json(), { ok: false, error: 'sign_in_required' })
})

test('a valid user cannot use another workspace or a truthy malformed membership response', async () => {
  for (const membership of [false, 'true', { is_staff: true }, [true], null]) {
    let calls = 0
    const response = await handleGateway(request(), env, async () => ++calls === 1 ? userResponse() : Response.json(membership))
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { ok: false, error: 'workspace_access_denied' })
  }
})

test('health verifies the caller with Supabase and forwards workspace scope only to the RPC', async () => {
  const calls = []
  const response = await handleGateway(request(), env, async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? userResponse() : Response.json(true)
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGINS)
  assert.deepEqual(calls.map(call => call.url), ['https://database.example.test/auth/v1/user', 'https://database.example.test/rest/v1/rpc/is_staff'])
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.body, '{}')
  for (const { options } of calls) {
    assert.equal(options.headers.Authorization, authorized.Authorization)
    assert.equal(options.headers.apikey, env.SUPABASE_PUBLIC_KEY)
    assert.equal(options.redirect, 'manual')
    assert.ok(options.signal instanceof AbortSignal)
  }
  assert.equal(calls[0].options.headers['x-workspace-id'], undefined)
  assert.equal(calls[1].options.headers['x-workspace-id'], workspace)
  assert.deepEqual(await response.json(), {
    ok: true, integrationsConnected: true, database: true,
    features: { email: false, whatsapp: false, ai: 'none', push: false },
  })
})

test('upstream redirects, failures, invalid JSON, and oversized bodies return sanitized errors', async () => {
  const invalid = [
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example.test' } }),
    () => Response.json({ secret: 'private provider error' }, { status: 500 }),
    () => new Response('private unexpected markup'),
    () => new Response('x'.repeat(64 * 1024 + 1)),
    () => new Response('{}', { headers: { 'Content-Length': '9999999999' } }),
  ]
  for (const makeResponse of invalid) {
    let calls = 0
    const response = await handleGateway(request(), env, async () => { calls++; return makeResponse() })
    assert.equal(response.status, 502)
    assert.equal(calls, 1)
    assert.deepEqual(await response.json(), { ok: false, error: 'upstream_unavailable' })
  }
})

test('only validated user identities can reach the membership RPC', async () => {
  for (const payload of [{}, { id: 'not-a-user' }, { user: { id: userId } }]) {
    let calls = 0
    const response = await handleGateway(request(), env, async () => { calls++; return Response.json(payload) })
    assert.equal(response.status, 401)
    assert.equal(calls, 1)
  }
})

test('unsupported integrations and arbitrary proxy destinations do not perform upstream calls', async () => {
  for (const path of ['/whatsapp/send', '/email/send', '/ai', '/admin/users', '/proxy?url=https://attacker.example.test']) {
    const response = await handleGateway(request(path), env, mustNotFetch)
    assert.equal(response.status, 404)
  }
  assert.equal((await handleGateway(request('/health', authorized, 'POST'), env, mustNotFetch)).status, 405)
})

test('an upstream operation that does not finish is aborted at the validation deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let aborted = false
  const pending = handleGateway(request(), env, async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true
      reject(new Error('Private network diagnostic'))
    }, { once: true })
  }))
  t.mock.timers.tick(8001)
  const response = await pending
  assert.equal(aborted, true)
  assert.equal(response.status, 504)
  assert.deepEqual(await response.json(), { ok: false, error: 'upstream_timeout' })
})
