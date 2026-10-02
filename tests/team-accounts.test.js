import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import {
  accountActionPayload, checkStaffPasswordGate, compatiblePlatforms, defaultPlatforms,
  hasCrmAccess, issuedTeamCredentials, passwordOptions, requiredPlatforms, teamAccountNotice, validStaffPassword,
} from '../src/lib/teamAccounts.js'
import { ALL_ROLES, assignableRoles, canManagePerson } from '../src/lib/auth.js'

const target = { id: 'member-id', name: 'Test Member', email: 'member@example.test', role: 'coordinator', active: true,
  area_access: ['crm'], access_version: 4, password_change_required: false }
const strongPassword = 'Private-test-pass-123!'

test('manual credentials enforce the shared password policy; generation does not submit a stale manual value', () => {
  for (const value of ['', 'Aa1!b', 'alllowercase12345!', 'ALLUPPERCASE12345!', 'NoNumbersHere!!!!', 'NoSymbols123456789', 'A'.repeat(129) + '1!a']) {
    assert.equal(validStaffPassword(value), false)
    assert.throws(() => passwordOptions('manual', value))
  }
  assert.deepEqual(passwordOptions('manual', strongPassword), { password_mode: 'manual', temporary_password: strongPassword })
  assert.deepEqual(passwordOptions('generate', strongPassword), { password_mode: 'generate' })
  for (const password of ['Private test pass 123!', 'Private\tpass123456!', 'Private\u200Bpass123456!']) {
    assert.throws(() => passwordOptions('manual', password))
  }
  assert.equal(validStaffPassword('Private password 123!'), true, 'private passwords retain the existing policy')
})

test('manual and first-login passwords accept six or ten characters and reject five', () => {
  for (const password of ['Aa1!bb', 'Password1!']) {
    assert.equal(validStaffPassword(password), true)
    assert.deepEqual(passwordOptions('manual', password), { password_mode: 'manual', temporary_password: password })
  }
  assert.equal(validStaffPassword('Aa1!b'), false)
  assert.throws(() => passwordOptions('manual', 'Aa1!b'))
  assert.equal(validStaffPassword('A1!' + 'a'.repeat(125)), true)
  assert.equal(validStaffPassword('A1!' + 'a'.repeat(126)), false)
  assert.deepEqual(passwordOptions('generate', 'Aa1!b'), { password_mode: 'generate' })
})

test('credential actions bind the selected account and version, and resend always rotates with server generation', () => {
  const maliciousOptions = { id: 'other-member', expected_version: 1, password_mode: 'manual', temporary_password: strongPassword }
  assert.deepEqual(accountActionPayload(target, 'resend_credentials', maliciousOptions), { id: target.id, expected_version: 4, action: 'resend_credentials' })
  assert.deepEqual(accountActionPayload(target, 'deactivate', maliciousOptions), { id: target.id, expected_version: 4, action: 'deactivate' })
  assert.deepEqual(accountActionPayload(target, 'reset_password', maliciousOptions), { id: target.id, expected_version: 4, action: 'reset_password', password_mode: 'manual', temporary_password: strongPassword })
  assert.throws(() => accountActionPayload({ ...target, access_version: undefined }, 'reset_password'))
  assert.throws(() => accountActionPayload(target, 'delete'))
})

test('uncertain delivery preserves the server explanation without recommending another password reset', () => {
  const message = 'Email delivery could not be confirmed. Check the registered inbox and business Sent mail before issuing new credentials.'
  assert.deepEqual(teamAccountNotice({ email_status: 'unknown', email_sent: false, message }, 'Credentials emailed.'), { message, warning: true })
  const fallback = teamAccountNotice({ email_status: 'unknown', email_sent: true }, 'Credentials emailed.')
  assert.equal(fallback.warning, true)
  assert.match(fallback.message, /could not be confirmed/)
  assert.match(fallback.message, /registered inbox and business Sent mail/)
  assert.doesNotMatch(fallback.message, /Resend|generate and email/i)
})

test('delivery failure keeps the actionable backend message and supports older email_sent responses', () => {
  const message = 'Reconnect the business email account before trying again.'
  assert.deepEqual(teamAccountNotice({ email_status: 'failed', email_sent: false, message }, 'Credentials emailed.'), { message, warning: true })
  assert.deepEqual(teamAccountNotice({ email_sent: false, message }, 'Credentials emailed.'), { message, warning: true })
  const legacyFallback = teamAccountNotice({ email_sent: false }, 'Credentials emailed.')
  assert.equal(legacyFallback.warning, true)
  assert.match(legacyFallback.message, /email was not sent/)
  assert.doesNotMatch(legacyFallback.message, /Resend/i)
})

test('explicit accepted delivery wins over legacy flags and non-email warnings remain visible', () => {
  assert.deepEqual(teamAccountNotice({ email_status: 'accepted', email_sent: false }, 'Credentials email accepted.'), { message: 'Credentials email accepted.', warning: false })
  assert.deepEqual(teamAccountNotice({ warning: true, message: 'Sign-in ban needs retry.' }, 'Deactivated.'), { message: 'Sign-in ban needs retry.', warning: true })
  assert.deepEqual(teamAccountNotice({}, 'Team access updated.'), { message: 'Team access updated.', warning: false })
  const missingDelivery = teamAccountNotice({ expectsEmail: true }, 'Credentials emailed.')
  assert.equal(missingDelivery.warning, true)
  assert.match(missingDelivery.message, /could not be confirmed/)
})

test('delivery notices never render diagnostic provider fields or password payloads', () => {
  const result = teamAccountNotice({ email_status: 'failed', email_failure_reason: 'mailbox_connection', provider_error: 'private-provider-detail', temporary_password: strongPassword, message: { provider_error: 'private-provider-detail' } }, 'Credentials emailed.')
  assert.doesNotMatch(JSON.stringify(result), /private-provider-detail|mailbox_connection|Private-test-pass/)
  const unexpectedState = teamAccountNotice({ email_status: 'unexpected-provider-state', email_sent: true }, 'Credentials emailed.')
  assert.equal(unexpectedState.warning, true)
  assert.match(unexpectedState.message, /could not be confirmed/)
})

test('new temporary credentials are available only after successful credential issuance', () => {
  const result = { ok: true, expectsEmail: true, profile: target, temporary_password: strongPassword }
  assert.deepEqual(issuedTeamCredentials(result), { name: target.name, email: target.email, password: strongPassword })
  for (const response of [
    { ...result, ok: false }, { ...result, ok: undefined },
    { ...result, expectsEmail: false }, { ...result, expectsEmail: undefined },
    { ...result, profile: undefined }, { ...result, profile: { ...target, email: '' } },
    { ...result, temporary_password: undefined }, { ...result, temporary_password: 'Aa1!b' },
  ]) assert.equal(issuedTeamCredentials(response), null)
})

test('mail outages do not require another reset when a new usable password is available', () => {
  const result = { ok: true, expectsEmail: true, profile: target, temporary_password: strongPassword, email_sent: false }
  const failed = teamAccountNotice({ ...result, email_status: 'failed' }, 'Account updated.')
  assert.equal(failed.warning, true)
  assert.match(failed.message, /Copy these login details and use the new temporary password directly/)
  assert.doesNotMatch(failed.message, /trying again|resend|reconnect/i)
  const unknown = teamAccountNotice({ ...result, email_status: 'unknown' }, 'Account updated.')
  assert.match(unknown.message, /copy and use the new temporary password directly/)
  assert.match(unknown.message, /Check the registered inbox and business Sent mail/)
  assert.ok(!JSON.stringify(failed).includes(strongPassword) && !JSON.stringify(unknown).includes(strongPassword), 'notices never retain the secret')
})

test('management hierarchy protects self, peer managers and inactive administrators', () => {
  const admin = { id: 'admin', role: 'admin', active: true }
  const manager = { id: 'manager', role: 'sub-admin', active: true }
  for (const role of ALL_ROLES) {
    assert.equal(canManagePerson(admin, { id: 'other', role }), true)
    assert.equal(canManagePerson(manager, { id: 'other', role }), !['admin', 'sub-admin'].includes(role))
    assert.equal(canManagePerson({ id: 'regular', role: 'coordinator', active: true }, { id: 'other', role }), false)
  }
  assert.equal(canManagePerson(admin, admin), false)
  assert.equal(canManagePerson({ ...admin, active: false }, target), false)
  assert.equal(canManagePerson({ ...admin, password_change_required: true }, target), false)
  assert.deepEqual(assignableRoles(manager), ALL_ROLES.filter((role) => !['admin', 'sub-admin'].includes(role)))
})

test('workspace roles grant only CRM access and CRM admits only active provisioned members', () => {
  for (const role of ALL_ROLES) {
    assert.deepEqual(compatiblePlatforms(role), ['crm'])
    assert.deepEqual(defaultPlatforms(role), ['crm'])
    assert.deepEqual(requiredPlatforms(role), ['crm'])
  }
  assert.deepEqual(compatiblePlatforms('unknown-role'), [])
  assert.equal(hasCrmAccess(target), true)
  for (const profile of [null, { ...target, active: false }, { ...target, area_access: ['internal'] }, { ...target, area_access: undefined }, { ...target, password_change_required: true }]) {
    assert.equal(hasCrmAccess(profile), false)
  }
})

test('live gate catches administrator reset with an old JWT and ignores user-editable metadata', async () => {
  const checked = []
  const client = (user, data, error = null) => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name) => { checked.push(name); return { data, error } },
  })
  const user = { id: target.id, app_metadata: {}, user_metadata: { must_change_password: true } }
  assert.equal((await checkStaffPasswordGate(client(user, false))).required, false)
  assert.equal((await checkStaffPasswordGate(client(user, true))).required, true)
  assert.equal((await checkStaffPasswordGate(client({ ...user, app_metadata: { must_change_password: true } }, false))).required, true)
  await assert.rejects(checkStaffPasswordGate(client(user, null, new Error('unavailable'))))
  await assert.rejects(checkStaffPasswordGate(client(null, false)))
  assert.ok(checked.every((name) => name === 'staff_password_change_required'))
})

test('incomplete account setup uses only the trusted password completion marker for recovery', async () => {
  const completedAt = new Date().toISOString()
  const client = (metadata, pending = true, userMetadata = {}) => ({
    auth: { getUser: async () => ({ data: { user: { id: target.id, app_metadata: metadata, user_metadata: userMetadata } } }) },
    rpc: async () => ({ data: pending }),
  })
  assert.equal((await checkStaffPasswordGate(client({ must_change_password: false, password_change_completed_at: completedAt }))).recoveryRequired, true)
  assert.equal((await checkStaffPasswordGate(client({ must_change_password: true, password_change_completed_at: completedAt }))).recoveryRequired, false)
  assert.equal((await checkStaffPasswordGate(client({ must_change_password: false, password_change_completed_at: completedAt }, false))).recoveryRequired, false)
  assert.equal((await checkStaffPasswordGate(client({}, true, { password_change_completed_at: completedAt }))).recoveryRequired, false)
})

// Exercise the real CRM API wrappers with isolated Supabase/network boundaries.
// No credentials or records leave this process.
const mockClient = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) }, rpc: null }
globalThis.__crmTeamTestClient = mockClient
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/db.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  define: { 'import.meta.env.VITE_WORKER_URL': JSON.stringify('https://worker.example.test') },
  plugins: [{ name: 'test-supabase', setup(builder) {
    builder.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase', namespace: 'test-client' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-client' }, () => ({ contents: 'export const hasConfig = true; export const isSaas = false; export const activeWorkspaceId = null; export const workerUrl = "https://worker.example.test"; export const tenantHeaders = () => ({}); export const supabase = globalThis.__crmTeamTestClient;' }))
  } }],
})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
delete globalThis.__crmTeamTestClient

test('each account action uses one existing Worker call and sends only the intended recipient identifier', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    return new Response(JSON.stringify({ ok: true, profile: target, email_sent: true }), { status: 200 })
  })
  await api.insertProfile({ name: target.name, email: target.email, role: target.role, area_access: target.area_access, password_mode: 'generate' })
  await api.manageTeamAccount(target, 'reset_password', passwordOptions('manual', strongPassword))
  await api.manageTeamAccount(target, 'resend_credentials')
  await api.manageTeamAccount(target, 'deactivate')
  assert.deepEqual(calls.map((call) => call.url), [
    'https://worker.example.test/team/invite', 'https://worker.example.test/team/account',
    'https://worker.example.test/team/account', 'https://worker.example.test/team/account',
  ])
  assert.ok(calls.every((call) => call.headers.authorization === 'Bearer test-session'))
  assert.equal(calls[1].body.temporary_password, strongPassword)
  assert.ok(calls.slice(1).every((call) => call.body.id === target.id && !('email' in call.body)))
  assert.ok(calls.slice(2).every((call) => !('temporary_password' in call.body)))
})

test('delivery failure preserves successful state, and failed reset preserves fail-closed member version', async (t) => {
  const profile = { ...target, password_change_required: true, access_version: 5 }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, profile, email_sent: false, message: 'Email delivery failed.' })))
  assert.deepEqual((await api.manageTeamAccount(target, 'reset_password')).profile, profile)
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, profile, error: 'Account remains restricted.' }), { status: 502 })
  await assert.rejects(api.manageTeamAccount(target, 'reset_password'), (error) => error.payload.profile.access_version === 5 && error.status === 502)
})

test('successful password reset retains only the newly issued secret for its credential dialog', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, profile: target, temporary_password: strongPassword, email_status: 'failed', email_sent: false })))
  const result = await api.manageTeamAccount(target, 'reset_password')
  assert.equal(issuedTeamCredentials({ ...result, expectsEmail: true }).password, strongPassword)
  assert.equal(result.profile.temporary_password, undefined)
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'not authorized' }), { status: 403 })
  await assert.rejects(api.manageTeamAccount(target, 'reset_password'), (error) => error.status === 403 && error.payload.temporary_password === undefined)
})

test('access editing uses the versioned RPC and never grants legacy platform access or changes email', async () => {
  let call
  mockClient.rpc = async (name, params) => { call = { name, params }; return { data: { ...target, access_version: 5 } } }
  await api.updateTeamAccess(target, { role: 'reception', area_access: ['crm', 'internal'], reason: 'Changed responsibility', email: 'other@example.test' })
  assert.deepEqual(call, { name: 'update_team_member_access', params: { p_target_id: target.id, p_expected_version: 4, p_role: 'reception', p_active: true, p_area_access: ['crm'], p_reason: 'Changed responsibility' } })
})

test('temporary password completion makes one secure request without trying to reuse revoked refresh sessions', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{"ok":true}') })
  await api.completeTemporaryPassword(strongPassword)
  assert.deepEqual(calls, [{ url: 'https://worker.example.test/team/password/complete', body: { password: strongPassword } }])
})

test('password completion exposes the saved-password recovery signal without losing server state', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: false, password_saved: true, error: 'Finish setup after signing in again.' }), { status: 503 }))
  await assert.rejects(api.completeTemporaryPassword(strongPassword), (error) => error.payload.password_saved === true)
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { password: '' }, 'recovery never submits another chosen password')
    return new Response('{"ok":true,"recovered":true}')
  }
  assert.equal((await api.completeTemporaryPassword('')).recovered, true)
})
