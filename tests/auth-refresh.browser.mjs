// Run from this project: npm run test:browser
// Uses this project's Playwright dependency. All account/data requests
// are mocked; this regression never uses a live account or sends an email.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'

const server = await createServer({
  configFile: 'vite.config.js',
  define: {
    'import.meta.env.VITE_CRM_MODE': JSON.stringify('supabase'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://supabase.example.test'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
    'import.meta.env.VITE_WORKER_URL': JSON.stringify('https://worker.example.test'),
  },
  server: { host: '127.0.0.1', port: 5200, strictPort: true },
})
await server.listen()
const browser = await chromium.launch({ headless: true })
const issuedPassword = 'Only-test-password-123!'
const adminId = '11111111-1111-4111-8111-111111111111'
const otherId = '33333333-3333-4333-8333-333333333333'
const makeUser = (id, email) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} })
const adminUser = makeUser(adminId, 'admin@example.test')
const otherUser = makeUser(otherId, 'other@example.test')
const admin = { id: adminId, email: adminUser.email, name: 'Test Administrator', role: 'admin', active: true, area_access: ['crm'], access_version: 1, password_change_required: false }
const other = { ...admin, id: otherId, email: otherUser.email, name: 'Other Administrator' }
const member = { id: '22222222-2222-4222-8222-222222222222', name: 'Test Member', email: 'member@example.test', role: 'coordinator', active: true, area_access: ['crm'], access_version: 4, password_change_required: false }
const deferred = () => {
  let entered, release
  return { entered: new Promise((resolve) => { entered = resolve }), wait: new Promise((resolve) => { release = resolve }), markEntered: () => entered(), release: () => release() }
}

async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', () => errors.push('page error'))
  const state = { profiles: [admin, member], user: adminUser, gate: false, serial: 0, accountCalls: 0, profileCalls: 0, tokens: new Map() }
  const session = (user) => {
    const payload = { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', app_metadata: user.app_metadata, jti: String(++state.serial) }
    const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.test-signature'
    state.tokens.set(token, user)
    return { access_token: token, refresh_token: 'test-refresh-' + state.serial, token_type: 'bearer', expires_in: 3600, user }
  }
  const hold = async (key) => {
    const pending = state[key]
    state[key] = null
    if (pending) { pending.markEntered(); await pending.wait }
  }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
    if (!['supabase.example.test', 'worker.example.test'].includes(url.hostname)) return route.abort()
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/token') {
      const request = route.request().postDataJSON()
      if (request.email) state.user = request.email === otherUser.email ? otherUser : adminUser
      return reply(session(state.user))
    }
    if (url.pathname === '/auth/v1/user') return reply(state.tokens.get(route.request().headers().authorization?.replace(/^Bearer /, '')) || state.user)
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname === '/rest/v1/rpc/staff_password_change_required') {
      const gate = state.gate
      await hold('gateHold')
      return gate === 'error' ? reply({ message: 'Mock gate unavailable' }, 503) : reply(gate)
    }
    if (url.pathname === '/rest/v1/profiles') {
      state.profileCalls += 1
      const profiles = structuredClone(state.profiles)
      await hold('profileHold')
      return reply(profiles)
    }
    if (url.pathname === '/rest/v1/workspace_settings') {
      return reply({ config: { name: 'Test Workspace', setupComplete: true } })
    }
    if (url.pathname === '/team/account') {
      state.accountCalls += 1
      await hold('accountHold')
      return reply({ ok: true, profile: { ...member, access_version: 5, password_change_required: true }, temporary_password: issuedPassword, email_sent: false, email_status: 'failed' })
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply([])
    return reply({})
  })
  const refresh = () => page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.js'); const result = await supabase.auth.refreshSession(); if (result.error) throw new Error('Mock refresh failed') })
  const signOut = () => page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.js'); await supabase.auth.signOut({ scope: 'local' }) })
  const switchUser = () => page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.js'); await supabase.auth.signInWithPassword({ email: 'other@example.test', password: 'Test-password-123!' }) })
  const startReset = async () => {
    const row = page.locator('.row-between').filter({ has: page.getByText('Test Member', { exact: true }) })
    await row.getByRole('button', { name: 'Reset Password', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Reset password', exact: true }).click()
  }
  const assertPassword = async () => {
    await expect(page.getByRole('dialog', { name: 'Temporary login credentials' })).toBeVisible()
    assert.equal(await page.getByLabel('New temporary password', { exact: true }).inputValue(), issuedPassword, 'newly issued secret is retained')
  }
  try {
    await page.goto('http://127.0.0.1:5200', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.getByLabel('Email', { exact: true }).fill(adminUser.email)
    await page.getByLabel('Password', { exact: true }).fill('Test-password-123!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('tab', { name: 'Team', exact: true }).click()
    await expect(page.getByText('Test Member', { exact: true })).toBeVisible()
    await run({ page, state, refresh, signOut, switchUser, startReset, assertPassword })
    assert.equal(errors.length, 0, 'no browser exceptions')
    console.log('PASS ' + name)
  } finally {
    for (const key of ['gateHold', 'profileHold', 'accountHold']) state[key]?.release()
    await context.close()
  }
}

try {
  await scenario('open credentials survive token and profile verification while interaction stays blocked', async ({ page, state, refresh, startReset, assertPassword }) => {
    await startReset(); await assertPassword()
    const input = page.getByLabel('New temporary password', { exact: true })
    await input.evaluate((node) => { node.__sameCredentialNode = true })
    const gate = state.gateHold = deferred(), profile = state.profileHold = deferred()
    await refresh(); await gate.entered
    await expect(page.locator('.shell[inert]')).toHaveCount(1)
    assert.equal(await input.evaluate((node) => node.__sameCredentialNode), true)
    gate.release(); await profile.entered
    await expect(page.locator('.shell[inert]')).toHaveCount(1)
    assert.equal(await input.evaluate((node) => node.__sameCredentialNode), true)
    profile.release()
    await expect(page.locator('.shell[inert]')).toHaveCount(0)
    await assertPassword()
    assert.equal(await input.evaluate((node) => node.__sameCredentialNode), true)
    assert.equal(state.accountCalls, 1)
  })
  await scenario('pending password issuance survives a same-user token refresh', async ({ page, state, refresh, startReset, assertPassword }) => {
    const account = state.accountHold = deferred()
    await startReset(); await account.entered
    const form = page.locator('form.modal[role="dialog"]')
    await form.evaluate((node) => { node.__samePendingNode = true })
    const gate = state.gateHold = deferred()
    await refresh(); await gate.entered
    assert.equal(await form.evaluate((node) => node.__samePendingNode), true)
    account.release()
    await expect(page.locator('input[readonly]')).toHaveCount(1)
    await expect(page.locator('.shell[inert]')).toHaveCount(1)
    gate.release(); await expect(page.locator('.shell[inert]')).toHaveCount(0)
    await assertPassword()
    assert.equal(state.accountCalls, 1)
  })
  for (const mode of ['required', 'error', 'denied']) {
    await scenario('confirmed ' + mode + ' access clears open credentials', async ({ page, state, refresh, startReset, assertPassword }) => {
      await startReset(); await assertPassword()
      if (mode === 'denied') state.profiles = [{ ...admin, area_access: [] }, member]
      else state.gate = mode === 'required' ? true : 'error'
      await refresh()
      if (mode === 'required') await expect(page.getByRole('heading', { name: 'Choose your private password' })).toBeVisible()
      if (mode === 'error') await expect(page.getByRole('button', { name: 'Retry access check' })).toBeVisible()
      if (mode === 'denied') await expect(page.getByText('This account doesn’t have access.')).toBeVisible()
      await expect(page.getByLabel('New temporary password', { exact: true })).toHaveCount(0)
    })
  }
  await scenario('old pending credential response cannot populate another signed-in account', async ({ page, state, switchUser, startReset }) => {
    const account = state.accountHold = deferred()
    await startReset(); await account.entered
    state.profiles = [other]
    await switchUser()
    await expect(page.locator('.uname')).toHaveText('Other Administrator')
    await expect(page.getByText('Test Member', { exact: true })).toHaveCount(0)
    const delivered = page.waitForResponse((response) => response.url().endsWith('/team/account'))
    account.release(); await (await delivered).finished()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByLabel('New temporary password', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Test Member', { exact: true })).toHaveCount(0)
  })
  await scenario('old profile response cannot repopulate a later identity', async ({ page, state, refresh, switchUser }) => {
    const profile = state.profileHold = deferred()
    await refresh(); await profile.entered
    state.profiles = [other]
    await switchUser()
    await expect(page.locator('.uname')).toHaveText('Other Administrator')
    const delivered = page.waitForResponse((response) => new URL(response.url()).pathname === '/rest/v1/profiles')
    profile.release(); await (await delivered).finished()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByText('Test Member', { exact: true })).toHaveCount(0)
    await expect(page.locator('.uname')).toHaveText('Other Administrator')
  })
  await scenario('sign-out invalidates a pending gate and removes the credential dialog', async ({ page, state, refresh, signOut, startReset, assertPassword }) => {
    await startReset(); await assertPassword()
    const gate = state.gateHold = deferred()
    await refresh(); await gate.entered
    await signOut()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    const delivered = page.waitForResponse((response) => response.url().endsWith('/rest/v1/rpc/staff_password_change_required'))
    gate.release(); await (await delivered).finished()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('New temporary password', { exact: true })).toHaveCount(0)
  })
} finally {
  await browser.close()
  await server.close()
}
