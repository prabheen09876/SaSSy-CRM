// Run with: node tests/settings.browser.mjs
// Uses only demo records and an in-memory SaaS team fixture. No real account,
// invitation, email, or backend request is used by these checks.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { CONNECTION_KEY, WORKSPACE_SELECTION_KEY, INVITATION_KEY, ACCOUNT_SETUP_KEY, connectionIdentity } from '../src/lib/connections.js'

const port = 5202
const origin = `http://127.0.0.1:${port}`
const fixture = {
  profiles: [
    { id: 'owner', name: 'Alex Morgan', email: 'alex@northstar.test', role: 'admin', active: true, access_version: 1 },
    { id: 'manager', name: 'Sam Rivera', email: 'sam@northstar.test', role: 'sub-admin', active: true, access_version: 1 },
    { id: 'sales', name: 'Jordan Lee', email: 'jordan@northstar.test', role: 'coordinator', active: true, access_version: 4 },
  ],
  invites: [], calls: [],
}
const contextModule = `
import React, { createContext, useContext, useState } from 'react'
import SaasTeam from '/src/components/SaasTeam.jsx'
const Context = createContext(null)
export const useApp = () => useContext(Context)
window.__teamTest = ${JSON.stringify(fixture)}
export default function TeamHarness() {
  const [profiles, setProfiles] = useState(window.__teamTest.profiles)
  const [me, setMe] = useState(profiles[0])
  window.__setRole = (role) => setMe({ ...window.__teamTest.profiles.find((p) => p.role === role) })
  window.__refreshProfile = (id, change) => {
    window.__teamTest.profiles = window.__teamTest.profiles.map((p) => p.id === id ? { ...p, ...change } : p)
    setProfiles([...window.__teamTest.profiles])
  }
  return <Context.Provider value={{ me, profiles, workspace: { name: 'Northstar Studio' },
    notify: (text) => window.__teamTest.calls.push({ notify: text }),
    refreshProfiles: async () => setProfiles([...window.__teamTest.profiles]),
  }}><main className="settings-page" style={{ padding: 32, maxWidth: 940 }}><SaasTeam /></main></Context.Provider>
}
`
const apiModule = `
export const listInvitations = async () => {
  if (window.__teamTest.listError) throw Error('Invitation refresh unavailable')
  return window.__teamTest.invites
}
export const createInvitation = async (email, role) => {
  const item = { id: 'invite-' + Date.now(), token: 'private-token-' + Date.now(), email: email.toLowerCase(), role,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 604800000).toISOString() }
  window.__teamTest.calls.push({ create: { email, role } })
  window.__teamTest.invites.push({ ...item, token: undefined })
  return item
}
export const revokeInvitation = async (id) => {
  window.__teamTest.calls.push({ revoke: id })
  window.__teamTest.invites = window.__teamTest.invites.map((i) => i.id === id ? { ...i, revoked_at: new Date().toISOString() } : i)
}
export const updateMember = async (profile, change) => {
  window.__teamTest.calls.push({ update: { id: profile.id, version: profile.access_version, ...change } })
  const saved = { ...profile, ...change, access_version: profile.access_version + 1 }
  window.__teamTest.profiles = window.__teamTest.profiles.map((i) => i.id === saved.id ? saved : i)
  return saved
}
`
const modules = {
  '/__settings-test-context.jsx': contextModule,
  '/__settings-test-api.js': apiModule,
  '/__settings-test-main.jsx': `import React from 'react'; import { createRoot } from 'react-dom/client'; import TeamHarness from '/__settings-test-context.jsx'; import '/src/styles.css'; createRoot(document.getElementById('root')).render(<TeamHarness />)`,
}
const server = await createServer({
  configFile: 'vite.config.js',
  define: { 'import.meta.env.VITE_CRM_MODE': JSON.stringify('demo') },
  plugins: [{
    name: 'settings-browser-fixtures', enforce: 'pre',
    resolveId: (id) => Object.hasOwn(modules, id) ? id : null,
    load: (id) => modules[id] || null,
    transform(code, id) {
      if (id.endsWith('/src/components/SaasTeam.jsx')) {
        return code.replace("'../App.jsx'", "'/__settings-test-context.jsx'").replace("'../lib/saas'", "'/__settings-test-api.js'")
      }
      // Observe arguments while keeping the real demo adapter and Settings UI.
      if (id.endsWith('/src/lib/db.js')) {
        return code.replace('export async function upsertLeadType(row) {', 'export async function upsertLeadType(row) { window.__settingsSavedCategory = row;')
          .replace('export async function loadHealth() {', 'export async function loadHealth() { window.__settingsHealthCalls = (window.__settingsHealthCalls || 0) + 1;')
      }
      return null
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__settings-team') return next()
        try {
          const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__settings-test-main.jsx"></script></body></html>')
          response.setHeader('content-type', 'text/html'); response.end(html)
        } catch (error) { next(error) }
      })
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true },
})

let browser
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] })
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  try { await run(page); assert.deepEqual(errors, [], 'no browser runtime errors'); console.log(`PASS ${name}`) }
  finally { await context.close() }
}

async function enterDemo(page, name) {
  await page.addInitScript(() => localStorage.setItem('crm.workspace.v1', JSON.stringify({ name: 'Northstar Studio', industry: 'services', countryCode: '1', currency: 'USD', setupComplete: true })))
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Make this workspace yours' })).toBeVisible()
}

try {
  await mkdir('test-results', { recursive: true })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  await scenario('Settings tabs, draft retention, blank category source, keyboard and mobile layout', async (page) => {
    await enterDemo(page, 'Alex Morgan')
    const tabs = page.getByRole('tablist', { name: 'Settings sections' })
    await expect(tabs.getByRole('tab')).toHaveCount(7)
    await page.screenshot({ path: 'test-results/settings-overview-desktop.png', fullPage: true })
    await tabs.getByRole('tab', { name: 'Workspace', exact: true }).click()
    const workspaceName = page.getByLabel('Business / workspace name', { exact: true })
    await workspaceName.fill('Unsaved studio draft')
    await tabs.getByRole('tab', { name: 'Overview', exact: true }).click()
    await tabs.getByRole('tab', { name: 'Workspace', exact: true }).click()
    await expect(workspaceName).toHaveValue('Unsaved studio draft')
    await tabs.getByRole('tab', { name: 'Connections', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible()
    assert.ok(await page.evaluate(() => window.__settingsHealthCalls > 0), 'owners may read channel health')
    await tabs.getByRole('tab', { name: 'Intake', exact: true }).click()
    await page.getByPlaceholder('key (slug)', { exact: true }).fill('test_category')
    await page.locator('.line-row').filter({ has: page.getByPlaceholder('key (slug)', { exact: true }) }).getByPlaceholder('Label', { exact: true }).fill('Browser test category')
    await page.getByRole('button', { name: 'Add category', exact: true }).click()
    await expect(page.getByRole('switch', { name: 'Toggle Browser test category', exact: true })).toBeVisible()
    assert.equal(await page.evaluate(() => window.__settingsSavedCategory.default_source), '', 'optional source must not send null to a NOT NULL column')
    const overview = tabs.getByRole('tab', { name: 'Overview', exact: true })
    await overview.focus(); await overview.press('End')
    await expect(tabs.getByRole('tab', { name: 'Account', exact: true })).toHaveAttribute('aria-selected', 'true')
    await tabs.getByRole('tab', { name: 'Account', exact: true }).press('Home')
    await expect(overview).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/settings-overview-mobile.png', fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page must not overflow horizontally')
    assert.ok(await tabs.evaluate((element) => element.scrollWidth > element.clientWidth), 'settings tabs scroll internally on mobile')
  })
  await scenario('Settings permissions do not poll channel health for marketing staff', async (page) => {
    await enterDemo(page, 'Avery Patel')
    const tabs = page.getByRole('tablist', { name: 'Settings sections' })
    await expect(tabs.getByRole('tab')).toHaveCount(4)
    await expect(tabs.getByRole('tab', { name: 'Connections', exact: true })).toHaveCount(0)
    await expect(tabs.getByRole('tab', { name: 'Team & access', exact: true })).toHaveCount(0)
    assert.equal(await page.evaluate(() => window.__settingsHealthCalls || 0), 0)
  })
  await scenario('first-time standalone login offers SaaS setup without creating a login or saving a connection', async (page) => {
    const existing = { mode: 'supabase', supabaseUrl: 'https://empty-database.example.test', publicKey: 'sb_publishable_connection_test_key_123456', workerUrl: '' }
    await page.goto(origin)
    await page.evaluate(({ key, config }) => localStorage.setItem(key, JSON.stringify(config)), { key: CONNECTION_KEY, config: existing })
    await page.reload()
    await expect(page.getByText('This installation uses administrator-created accounts.', { exact: false })).toBeVisible()
    await page.screenshot({ path: 'test-results/standalone-first-setup-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/standalone-first-setup-mobile.png', fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'first-time setup must fit a mobile screen')
    await page.getByRole('button', { name: 'Set up SaaS accounts', exact: true }).click()
    await expect(page.getByLabel('Installation type', { exact: true })).toHaveValue('saas')
    await expect(page.getByLabel('Supabase project URL', { exact: true })).toHaveValue(existing.supabaseUrl)
    await expect(page.getByText('No login is created by saving this connection.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save connection & reload', exact: true })).toBeDisabled()
    assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), CONNECTION_KEY), existing, 'opening setup must not change the saved installation')
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Set up SaaS accounts', exact: true })).toBeVisible()
  })
  await scenario('a reachable empty database cannot pass setup in either installation mode', async (page) => {
    const database = 'https://empty-database.example.test'
    let schema = null
    await page.route(`${database}/**`, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/auth/v1/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      if (url.pathname === '/rest/v1/rpc/crm_schema_info') return route.fulfill({ status: schema ? 200 : 404, contentType: 'application/json', body: JSON.stringify(schema || { code: 'PGRST202' }) })
      return route.abort()
    })
    await page.goto(origin)
    await page.getByRole('button', { name: 'Connect a real database', exact: true }).click()
    const mode = page.getByLabel('Installation type', { exact: true })
    const test = page.getByRole('button', { name: 'Test connection', exact: true })
    const save = page.getByRole('button', { name: 'Save connection & reload', exact: true })
    await mode.selectOption('supabase')
    await page.getByLabel('Supabase project URL', { exact: true }).fill(database)
    await page.getByLabel('Supabase publishable key', { exact: true }).fill('sb_publishable_connection_test_key_123456')
    await page.getByRole('checkbox', { name: /I understand this signs me out/ }).check()
    await test.click()
    await expect(page.getByRole('alert')).toContainText('standalone CRM schema is missing')
    await expect(save).toBeDisabled()
    await mode.selectOption('saas')
    await test.click()
    await expect(page.getByRole('alert')).toContainText('SaaS CRM schema is missing')
    await expect(save).toBeDisabled()
    schema = { mode: 'supabase', version: 1 }
    await test.click()
    await expect(page.getByRole('alert')).toContainText('Choose Standalone under Installation type')
    await expect(save).toBeDisabled()
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), CONNECTION_KEY), null)
  })
  await scenario('connection setup rejects private keys, probes without old credentials, and advances to first account creation', async (page) => {
    const database = 'https://new-database.example.test'
    const publicKey = 'sb_publishable_connection_test_key_123456'
    const oldToken = 'old-project-token-must-not-be-forwarded'
    const oldAuthKey = `workspace-crm-auth-v2:${connectionIdentity({ supabaseUrl: 'https://old-database.example.test' })}`
    const probes = []
    // Page routing overrides the default external-request block for this fake
    // origin only. Unexpected requests still fail and cannot reach the network.
    await page.route(`${database}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      probes.push({ path: url.pathname, method: request.method(), headers: request.headers(), body: request.postData() })
      const data = url.pathname === '/auth/v1/settings' ? { external: { email: true } }
        : url.pathname === '/rest/v1/rpc/crm_schema_info' ? { mode: 'saas', version: 1 } : null
      if (!data) return route.abort()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(origin)
    await page.getByRole('button', { name: 'Connect a real database', exact: true }).click()
    await page.getByLabel('Installation type', { exact: true }).selectOption('saas')
    await page.evaluate(({ selectionKey, invitationKey, authKey, token, database }) => {
      sessionStorage.setItem(selectionKey, JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', userId: 'old-user', project: 'old-project' }))
      sessionStorage.setItem(invitationKey, JSON.stringify({ project: 'old-project', token: 'a'.repeat(64) }))
      sessionStorage.setItem('workspace-crm.dashboard-state.v1', JSON.stringify({ search: 'old customer data' }))
      localStorage.setItem(authKey, JSON.stringify({ access_token: token, refresh_token: 'old-refresh-token', expires_at: 9999999999, user: { id: 'old-user' } }))
      const originalFetch = window.fetch.bind(window)
      window.__connectionProbeOptions = []
      window.fetch = (input, options) => {
        if (String(input).startsWith(database)) window.__connectionProbeOptions.push({ credentials: options?.credentials, redirect: options?.redirect })
        return originalFetch(input, options)
      }
    }, { selectionKey: WORKSPACE_SELECTION_KEY, invitationKey: INVITATION_KEY, authKey: oldAuthKey, token: oldToken, database })
    await page.getByLabel('Supabase project URL', { exact: true }).fill(`${database}/`)
    const keyField = page.getByLabel('Supabase publishable key', { exact: true })
    const test = page.getByRole('button', { name: 'Test connection', exact: true })
    const save = page.getByRole('button', { name: 'Save connection & reload', exact: true })
    const confirmation = page.getByRole('checkbox', { name: /I understand this signs me out/ })
    await expect(save).toBeDisabled()
    await keyField.fill('sb_secret_rejected_private_key')
    await test.click()
    await expect(page.getByRole('alert')).toContainText('Secret keys cannot be used here')
    const serviceKey = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.test-signature`
    await keyField.fill(serviceKey)
    await test.click()
    await expect(page.getByRole('alert')).toContainText('Never enter a service-role key')
    assert.equal(probes.length, 0, 'private keys must be rejected before any network probe')
    await keyField.fill(publicKey)
    await confirmation.check()
    await expect(save).toBeDisabled()
    await test.click()
    await expect(page.getByRole('status')).toContainText('SaaS schema verified')
    await expect(save).toBeEnabled()
    await confirmation.uncheck()
    await expect(save).toBeDisabled()
    await confirmation.check()
    // Any edit invalidates both the successful probe and the acknowledgement.
    await page.getByLabel('Supabase project URL', { exact: true }).fill(database)
    await expect(confirmation).not.toBeChecked()
    await expect(save).toBeDisabled()
    await test.click()
    await expect(page.getByRole('status')).toContainText('SaaS schema verified')
    await expect(save).toBeDisabled()
    await confirmation.check()
    await expect(save).toBeEnabled()
    assert.equal(probes.length, 4)
    for (const probe of probes) {
      assert.equal(probe.headers.apikey, publicKey)
      assert.equal(probe.headers.authorization, undefined, 'connection checks must not use a current account token')
      assert.equal(probe.headers.cookie, undefined)
      assert.ok(!JSON.stringify(probe).includes(oldToken))
      assert.equal(probe.method, probe.path.endsWith('crm_schema_info') ? 'POST' : 'GET')
      if (probe.path.endsWith('crm_schema_info')) assert.equal(probe.body, '{}')
    }
    assert.deepEqual(await page.evaluate(() => window.__connectionProbeOptions), Array.from({ length: 4 }, () => ({ credentials: 'omit', redirect: 'error' })))
    await Promise.all([page.waitForEvent('domcontentloaded'), save.click()])
    await expect(page.getByRole('status')).toContainText('Database connected. Next, choose your own email and password.')
    await expect(page.getByLabel('Your name', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/saas-first-account-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/saas-first-account-mobile.png', fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'account creation must fit a mobile screen')
    await expect(page.getByRole('button', { name: /Alex Morgan/ })).toHaveCount(0)
    const stored = await page.evaluate(({ configKey, selectionKey, invitationKey }) => ({
      config: JSON.parse(localStorage.getItem(configKey)), selection: sessionStorage.getItem(selectionKey),
      invitation: sessionStorage.getItem(invitationKey), dashboard: sessionStorage.getItem('workspace-crm.dashboard-state.v1'),
    }), { configKey: CONNECTION_KEY, selectionKey: WORKSPACE_SELECTION_KEY, invitationKey: INVITATION_KEY })
    assert.deepEqual(stored, { config: { mode: 'saas', supabaseUrl: database, publicKey, workerUrl: '' }, selection: null, invitation: null, dashboard: null })
    assert.equal(probes.length, 4, 'the new project must not reuse the old project session after reload')
    assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), ACCOUNT_SETUP_KEY), null, 'the signup handoff is consumed once, not a persistent forced-signup loop')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create an account', exact: true })).toBeVisible()
    await expect(page.getByLabel('Your name', { exact: true })).toHaveCount(0)
  })
  await scenario('SaaS invitation links, access updates, fresh revisions, revocation and manager hierarchy', async (page) => {
    await page.goto(`${origin}/__settings-team`)
    await expect(page.getByRole('heading', { name: 'Team & access', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit access', exact: true })).toHaveCount(2)
    assert.equal(await page.getByLabel('Workspace role', { exact: true }).locator('option[value="admin"]').count(), 0, 'owners cannot invite new owners')
    await page.getByLabel('Email address', { exact: true }).fill('new@northstar.test')
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click()
    await expect(page.getByText('No email has been sent.', { exact: false })).toBeVisible()
    const link = await page.getByLabel('Invitation link', { exact: true }).inputValue()
    assert.match(link, new RegExp(`^${origin}/__settings-team#invite=private-token-`))
    await page.getByRole('button', { name: 'Copy link', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link)
    await page.screenshot({ path: 'test-results/saas-team-desktop.png', fullPage: true })
    const member = page.locator('.saas-member').filter({ hasText: 'Jordan Lee' })
    await member.getByRole('button', { name: 'Edit access', exact: true }).click()
    await member.getByLabel('Workspace role', { exact: true }).selectOption('reception')
    await member.getByLabel('Active workspace access').uncheck()
    await member.getByRole('button', { name: 'Save access', exact: true }).click()
    await expect(member.getByText('Inactive', { exact: true })).toBeVisible()
    assert.equal(await page.evaluate(() => window.__teamTest.calls.find((call) => call.update).update.version), 4)
    await page.evaluate(() => window.__refreshProfile('sales', { role: 'marketing', active: true, access_version: 6 }))
    await expect(member.getByText('Marketing', { exact: true })).toBeVisible()
    await expect(member.getByText('Inactive', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(page.getByLabel('Invitation link', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible()
    await page.evaluate(() => { window.__teamTest.listError = true })
    await page.getByLabel('Email address', { exact: true }).fill('another@northstar.test')
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click()
    await expect(page.getByLabel('Invitation link', { exact: true })).toBeVisible()
    await expect(page.getByText('Invitation refresh unavailable', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/saas-team-mobile.png', fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.evaluate(() => window.__setRole('sub-admin'))
    await expect(page.getByRole('heading', { name: 'Invite a teammate', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Invitation link', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit access', exact: true })).toHaveCount(1)
    await member.getByRole('button', { name: 'Edit access', exact: true }).click()
    assert.equal(await member.getByLabel('Workspace role', { exact: true }).locator('option').count(), 3)
  })
} finally {
  if (browser) await browser.close()
  await server.close()
}
