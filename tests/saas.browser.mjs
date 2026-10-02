// Integrated SaaS regression. All remote requests are mocked; this file never
// contacts a live Supabase project, sends an email, or creates a real workspace.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'

const origin = 'http://127.0.0.1:5201'
const databaseOrigin = 'https://saas.example.test'
const userId = '11111111-1111-4111-8111-111111111111'
const alphaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const betaId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const newId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const invitationToken = '0123456789abcdef'.repeat(4)
const user = {
  id: userId, email: 'member@example.test', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: { name: 'Test Member' },
  email_confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
}
const alpha = { id: alphaId, name: 'Alpha Studio', role: 'admin', active: true }
const beta = { id: betaId, name: 'Beta Services', role: 'reception', active: true }
const profile = (workspace) => ({
  id: userId, workspace_id: workspace.id, email: user.email, name: 'Test Member',
  role: workspace.role, active: true, area_access: ['crm'], access_version: 1,
  password_change_required: false,
})
const lead = (workspace) => ({
  id: workspace.id === alphaId ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
  workspace_id: workspace.id, name: `${workspace.name} private contact`,
  phone: '+12025550181', email: '', company: workspace.name,
  journey_status: 'New Lead', qual_status: 'Not Yet Contacted',
  assigned_to: userId, created_by: userId, created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-09-01T09:00:00Z', deleted_at: null, custom_fields: {}, currency: 'USD', budget: 100,
})

const server = await createServer({
  configFile: 'vite.config.js',
  define: {
    'import.meta.env.VITE_CRM_MODE': JSON.stringify('saas'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(databaseOrigin),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('sb_publishable_browser_test_public_key'),
    'import.meta.env.VITE_WORKER_URL': JSON.stringify(''),
    'import.meta.env.VITE_ALLOW_CONNECTION_SETUP': JSON.stringify('false'),
  },
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
})
await server.listen()
const browser = await chromium.launch({ headless: true })

async function scenario(name, initialWorkspaces, run, initialHash = '') {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const state = {
    workspaces: structuredClone(initialWorkspaces), configs: new Map(), serial: 0, tokens: new Map(),
    signInCalls: 0, signup: [], recover: [], create: [], accept: [], tableRequests: [], rpcRequests: [],
    scopeViolations: [], unexpectedRequests: [], invitationError: null,
    logoutCalls: 0, logoutFailures: 0, passwordUpdates: [],
  }
  const session = () => {
    const payload = { sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', jti: String(++state.serial) }
    const access_token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-signature`
    state.tokens.set(access_token, user)
    return { access_token, refresh_token: `test-refresh-${state.serial}`, token_type: 'bearer', expires_in: 3600, user }
  }
  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.origin === origin) return route.continue()
    if (url.origin !== databaseOrigin) return route.abort()
    const headers = req.headers()
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/signup') {
      state.signup.push({ body: req.postDataJSON(), redirect: url.searchParams.get('redirect_to') })
      return reply(user)
    }
    if (url.pathname === '/auth/v1/recover') {
      state.recover.push({ body: req.postDataJSON(), redirect: url.searchParams.get('redirect_to') })
      return reply({})
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') state.signInCalls++
      return reply(session())
    }
    if (url.pathname === '/auth/v1/user') {
      const identity = state.tokens.get(headers.authorization?.replace(/^Bearer /i, ''))
      if (identity && req.method() === 'PUT') state.passwordUpdates.push(req.postDataJSON())
      return identity ? reply(identity) : reply({ message: 'Mock session is invalid' }, 401)
    }
    if (url.pathname === '/auth/v1/logout') {
      state.logoutCalls++
      if (state.logoutFailures > 0) {
        state.logoutFailures--
        return reply({ message: 'Mock sign-out is temporarily unavailable. Try again.' }, 503)
      }
      return reply({})
    }

    const current = state.workspaces.find((workspace) => workspace.id === headers['x-workspace-id'])
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').at(-1)
      state.rpcRequests.push({ rpc, workspace: headers['x-workspace-id'] || null })
      if (rpc === 'list_my_workspaces') return reply(state.workspaces)
      if (rpc === 'create_workspace') {
        const body = req.postDataJSON()
        state.create.push(body)
        const created = { id: newId, name: body.p_name, role: 'admin', active: true }
        state.workspaces.push(created)
        state.configs.set(newId, body.p_config)
        return reply(newId)
      }
      if (rpc === 'accept_workspace_invitation') {
        const body = req.postDataJSON()
        state.accept.push(body)
        if (state.invitationError) return reply({ message: state.invitationError }, 400)
        if (body.p_token !== invitationToken) return reply({ message: 'Invitation is invalid' }, 400)
        state.workspaces.push({ id: betaId, name: beta.name, role: 'coordinator', active: true })
        return reply(betaId)
      }
      if (!current) {
        state.scopeViolations.push(`RPC ${rpc} has no authorized workspace header`)
        return reply({ message: 'Missing workspace scope' }, 403)
      }
      if (rpc === 'crm_team_profiles') return reply([profile(current)])
      if (rpc === 'staff_password_change_required') return reply(false)
      if (rpc === 'crm_leads_revision') return reply([{ active_count: 1, latest_created_at: '2026-09-01T09:00:00Z', latest_updated_at: '2026-09-01T09:00:00Z' }])
      if (rpc === 'list_workspace_invitations') return reply([])
      state.unexpectedRequests.push(`RPC ${rpc}`)
      return reply({ message: 'Unexpected mock RPC' }, 404)
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1)
      const scope = url.searchParams.get('workspace_id')
      state.tableRequests.push({ table, workspace: headers['x-workspace-id'] || null, filter: scope, method: req.method() })
      if (!current || scope !== `eq.${current.id}`) {
        state.scopeViolations.push(`Table ${table} does not match workspace header and filter`)
        return reply({ message: 'Missing workspace scope' }, 403)
      }
      if (req.method() !== 'GET') {
        state.unexpectedRequests.push(`${req.method()} ${table}`)
        return reply({ message: 'Unexpected table write' }, 405)
      }
      if (table === 'workspace_settings') return reply({ config: state.configs.get(current.id) || { name: current.name, setupComplete: true } })
      if (table === 'leads') return reply([lead(current)])
      if (['lead_types', 'activities', 'notifications', 'meetings', 'messages', 'templates', 'automations', 'lead_forms'].includes(table)) return reply([])
      state.unexpectedRequests.push(`Table ${table}`)
      return reply({ message: 'Unexpected mock table' }, 404)
    }
    state.unexpectedRequests.push(url.pathname)
    return reply({ message: 'Unexpected mock endpoint' }, 404)
  })

  const signIn = async () => {
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill('Mock-password-123!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your work, in its own space.' })).toBeVisible()
  }
  const openWorkspace = async (workspace) => {
    await page.getByRole('button', { name: new RegExp(`${workspace.name} .*Open workspace`) }).click()
    await expect(page.locator('.topbar .workspace-brand-name')).toHaveText(workspace.name)
    await expect(page.getByRole('button', { name: `${workspace.name} private contact`, exact: true }).first()).toBeVisible()
  }
  const assertScope = (workspaceId) => {
    const rows = state.tableRequests.filter((request) => request.workspace === workspaceId)
    assert.ok(rows.length >= 3, 'the selected workspace loaded multiple core tables')
    for (const table of ['leads', 'lead_types', 'workspace_settings']) assert.ok(rows.some((request) => request.table === table), `${table} was queried`)
    for (const request of rows) assert.equal(request.filter, `eq.${workspaceId}`, `${request.table} has an explicit workspace filter`)
    assert.ok(state.rpcRequests.some((request) => request.rpc === 'crm_team_profiles' && request.workspace === workspaceId), 'team identity is scoped to the selected workspace')
  }
  try {
    await page.goto(`${origin}/${initialHash}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await run({ page, state, signIn, openWorkspace, assertScope, makeSession: session })
    assert.deepEqual(state.scopeViolations, [], 'all protected requests are scoped')
    assert.deepEqual(state.unexpectedRequests, [], 'no unexpected integration or provider calls')
    assert.deepEqual(errors, [], 'no browser exceptions')
    console.log(`PASS ${name}`)
  } finally {
    await context.close()
  }
}

try {
  await scenario('self-service signup and password reset use the public authentication flow', [], async ({ page, state }) => {
    await page.getByRole('button', { name: 'Create an account', exact: true }).click()
    await page.getByLabel('Your name', { exact: true }).fill('Test Member')
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill('Mock-password-123!')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page.getByText(/Check your inbox to verify your email/)).toBeVisible()
    assert.equal(state.signup.length, 1)
    assert.equal(state.signup[0].body.email, user.email)
    assert.equal(state.signup[0].body.data.name, 'Test Member')
    assert.equal(state.signup[0].redirect, `${origin}/`)
    assert.equal(state.tableRequests.length, 0, 'signup does not load protected records')

    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
    await expect(page.getByText('If an account exists, a password reset link will arrive in your inbox.')).toBeVisible()
    assert.equal(state.recover.length, 1)
    assert.equal(state.recover[0].body.email, user.email)
    assert.equal(state.recover[0].redirect, `${origin}/`)
    assert.equal(state.signInCalls, 0)
  })

  await scenario('a failed chooser sign-out preserves the account and permits a successful retry', [alpha], async ({ page, state, signIn }) => {
    await signIn()
    state.logoutFailures = 1
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Could not sign out. Check your connection and try again.')
    await expect(page.getByRole('heading', { name: 'Your work, in its own space.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
    assert.equal(state.logoutCalls, 1)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your work, in its own space.' })).toHaveCount(0)
    assert.equal(state.logoutCalls, 2)
    assert.equal(state.tableRequests.length, 0)
  })

  await scenario('password recovery preserves its form when sign-out fails and finishes after retry', [], async ({ page, state, makeSession }) => {
    const recoverySession = makeSession()
    const params = new URLSearchParams({
      access_token: recoverySession.access_token,
      refresh_token: recoverySession.refresh_token,
      token_type: recoverySession.token_type,
      expires_in: String(recoverySession.expires_in),
      expires_at: String(Math.floor(Date.now() / 1000) + recoverySession.expires_in),
      type: 'recovery',
    })
    // A new document lets Supabase consume the same callback format as an email
    // recovery link; no private SDK callbacks or application state are modified.
    await page.goto(`${origin}/?recovery-fixture=1#${params}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    const password = page.getByLabel('New password', { exact: true })
    await password.fill('Recovered-mock-password-123!')
    state.logoutFailures = 1
    await page.getByRole('button', { name: 'Save password & sign out', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Could not sign out. Check your connection and try again.')
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await expect(password).toHaveValue('Recovered-mock-password-123!')
    assert.equal(state.passwordUpdates.length, 1)
    assert.equal(state.passwordUpdates[0].password, 'Recovered-mock-password-123!')
    assert.equal(state.logoutCalls, 1)
    await page.getByRole('button', { name: 'Save password & sign out', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0)
    assert.equal(state.logoutCalls, 2)
    assert.equal(state.signInCalls, 0, 'the recovery callback supplies the temporary authenticated session')
    assert.equal(state.tableRequests.length, 0)
  })

  await scenario('first workspace creation keeps the account session and selected workspace across reloads', [], async ({ page, state, signIn, assertScope }) => {
    await signIn()
    await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
    assert.equal(state.tableRequests.length, 0, 'no records before a workspace is selected')
    await page.getByLabel('Business name', { exact: true }).fill('New Consulting')
    await page.getByLabel('Industry', { exact: true }).selectOption('services')
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(page.locator('.topbar .workspace-brand-name')).toHaveText('New Consulting')
    await expect(page.getByRole('tab', { name: 'Prospects', exact: true })).toBeVisible()
    await expect(page.locator('.who .role')).toHaveText('Owner')
    assert.equal(state.create.length, 1)
    assert.equal(state.create[0].p_name, 'New Consulting')
    assert.equal(state.create[0].p_config.industry, 'services')
    assert.equal(state.create[0].p_config.setupComplete, true)
    assert.equal(state.create[0].p_config.terminology.recordPlural, 'Prospects')
    const beforeReload = state.tableRequests.length
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.topbar .workspace-brand-name')).toHaveText('New Consulting')
    await expect(page.getByRole('tab', { name: 'Prospects', exact: true })).toBeVisible()
    await expect.poll(() => state.tableRequests.length).toBeGreaterThan(beforeReload)
    assert.equal(state.signInCalls, 1, 'reload reuses the saved session instead of requiring another password')
    assert.equal(state.create.length, 1, 'reload does not create a duplicate workspace')
    assertScope(newId)
  })

  await scenario('workspace switching clears prior records and applies separate owner and support roles', [alpha, beta], async ({ page, state, signIn, openWorkspace, assertScope }) => {
    await signIn()
    await expect(page.getByRole('region', { name: 'Your workspaces' })).toBeVisible()
    assert.equal(state.tableRequests.length, 0)
    await openWorkspace(alpha)
    await expect(page.locator('.who .role')).toHaveText('Owner')
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Team', exact: true })).toBeVisible()
    await expect(page.getByText(`${beta.name} private contact`, { exact: true })).toHaveCount(0)
    assertScope(alphaId)

    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your work, in its own space.' })).toBeVisible()
    await expect(page.getByText(`${alpha.name} private contact`, { exact: true })).toHaveCount(0)
    await openWorkspace(beta)
    await expect(page.locator('.who .role')).toHaveText('Support')
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveCount(0)
    await expect(page.getByText(`${alpha.name} private contact`, { exact: true })).toHaveCount(0)
    assert.equal(state.signInCalls, 1, 'switching workspaces reuses the same authenticated account')
    assertScope(betaId)
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('tablist', { name: 'Settings sections' })
    await expect(settings.getByRole('tab', { name: 'Account', exact: true })).toBeVisible()
    await expect(settings.getByRole('tab', { name: 'Workspace', exact: true })).toHaveCount(0)
    await expect(settings.getByRole('tab', { name: 'Connections', exact: true })).toHaveCount(0)
    await expect(settings.getByRole('tab', { name: 'Team & access', exact: true })).toHaveCount(0)
  })

  await scenario('an invitation survives sign-in and joins only the invited workspace', [alpha], async ({ page, state, signIn, assertScope }) => {
    await expect(page.getByText('Sign in or create an account with the invited email address to join the workspace.')).toBeVisible()
    assert.equal(new URL(page.url()).hash, '', 'invitation is removed from the visible URL')
    await signIn()
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await expect(page.locator('.topbar .workspace-brand-name')).toHaveText(beta.name)
    await expect(page.locator('.who .role')).toHaveText('Sales')
    await expect(page.getByRole('tab', { name: 'Team', exact: true })).toHaveCount(0)
    assert.deepEqual(state.accept, [{ p_token: invitationToken }])
    assert.equal(state.create.length, 0)
    assertScope(betaId)
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your work, in its own space.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: new RegExp(`${alpha.name} .*Open workspace`) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`${beta.name} .*Open workspace`) })).toBeVisible()
    assert.equal(state.accept.length, 1, 'accepted invitations are not replayed after reload')
  }, `#invite=${invitationToken}`)

  await scenario('an invitation pasted into an already-open workspace is handled without a manual reload', [alpha], async ({ page, state, signIn, openWorkspace, assertScope }) => {
    await signIn()
    await openWorkspace(alpha)
    const originalDocument = await page.evaluate(() => performance.timeOrigin)
    await page.goto(`${origin}/#invite=${invitationToken}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Join an invited workspace' })).toBeVisible()
    assert.equal(await page.evaluate(() => performance.timeOrigin), originalDocument, 'a hash-only invitation is processed in the existing document')
    assert.equal(new URL(page.url()).hash, '', 'the invitation is removed from the visible URL')
    await expect(page.getByText(`${alpha.name} private contact`, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await expect(page.locator('.topbar .workspace-brand-name')).toHaveText(beta.name)
    await expect(page.locator('.who .role')).toHaveText('Sales')
    assert.deepEqual(state.accept, [{ p_token: invitationToken }])
    assert.equal(state.signInCalls, 1, 'the existing authenticated account accepts the invitation')
    assertScope(betaId)
  })

  await scenario('a rejected invitation reports the problem without granting access or loading records', [], async ({ page, state, signIn }) => {
    state.invitationError = 'This invitation has expired or was revoked.'
    await signIn()
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(state.invitationError)
    await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeEnabled()
    assert.equal(state.tableRequests.length, 0)
    assert.equal(state.accept.length, 1)
    assert.equal(state.workspaces.length, 0)
  }, `#invite=${invitationToken}`)
} finally {
  await browser.close()
  await server.close()
}
