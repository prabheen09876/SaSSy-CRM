// Run with: npm run test:call
// Real demo UI, isolated in-memory fixtures, and no live business writes.
// A capture-phase handler ALWAYS prevents telephone-link default actions:
// these checks must never open an OS dialer or place an actual call.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'

const port = 5205
const origin = `http://127.0.0.1:${port}`
const mayaHref = 'tel:+12025550101'
const server = await createServer({
  configFile: 'vite.config.js',
  define: { 'import.meta.env.VITE_CRM_MODE': JSON.stringify('demo') },
  plugins: [{
    name: 'call-test-isolated-demo-fixtures',
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/lib/demo.js')) return null
      // Only this test server sees these hooks. Production source and saved
      // data are untouched; snapshots expose the real demo backend state.
      return `${code}\n
        if (window.__callPhoneFixtures) {
          leads = leads.map((lead) => Object.hasOwn(window.__callPhoneFixtures, lead.name)
            ? { ...lead, phone: window.__callPhoneFixtures[lead.name] } : lead)
        }
        window.__callModelSnapshot = () => structuredClone({ leads, activities, messages, appointments, trash })
      `
    },
  }],
  server: { host: '127.0.0.1', port, strictPort: true },
})

let browser
let passed = 0
async function scenario(name, run, { width = 390, mode = 'light', accent, phones = {}, ...options } = {}) {
  if (process.env.CALL_TEST_FILTER && !new RegExp(process.env.CALL_TEST_FILTER).test(name)) return
  const context = await browser.newContext({
    viewport: { width, height: 844 }, colorScheme: mode, hasTouch: true, serviceWorkers: 'block', ...options,
  })
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const errors = []
  context.on('page', (page) => {
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => errors.push(error.message))
  })
  await context.addInitScript(({ expectedOrigin, mode, accent, phones }) => {
    if (location.origin !== expectedOrigin) return
    localStorage.setItem('crm.workspace.v1', JSON.stringify({
      name: 'Northstar Studio', industry: 'general', currency: 'USD', countryCode: '1', setupComplete: true,
    }))
    localStorage.setItem('workspace-crm.theme', mode)
    if (accent) localStorage.setItem('workspace-crm.accent', accent)
    window.__callPhoneFixtures = phones
    window.__interceptedCalls = []
    window.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (anchor?.getAttribute('href')?.toLowerCase().startsWith('tel:')) {
        event.preventDefault()
        window.__interceptedCalls.push({ href: anchor.getAttribute('href'), prevented: event.defaultPrevented })
        // Do not stop propagation: the application's row/pin handling must
        // still be exercised, including for taps and keyboard activation.
      }
    }, true)
    window.__callInterceptInstalled = true
  }, { expectedOrigin: origin, mode, accent, phones })
  const page = await context.newPage()
  try {
    await run(page, context)
    assert.deepEqual(errors, [], 'no browser runtime errors')
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.profile *, .lead-card *')].map((element) => {
      const rect = element.getBoundingClientRect()
      return { element: element.tagName, class: element.className, width: rect.width, right: rect.right, text: element.textContent?.slice(0, 65) }
    }).filter((element) => element.width && element.right > innerWidth + 1).slice(0, 15))
    console.error(`FAIL ${name}`, { runtimeErrors: errors, overflow, pageText: (await page.locator('body').innerText()).slice(-2600) })
    await page.screenshot({ path: 'test-results/call-failure.png', fullPage: true, animations: 'disabled' }).catch(() => {})
    throw error
  } finally { await context.close() }
}

const leadCard = (page, name = 'Maya Chen') => page.locator('.lead-card').filter({ has: page.getByRole('button', { name, exact: true }) })
const cardCall = (page, name = 'Maya Chen') => leadCard(page, name).getByRole('link', { name: new RegExp(`^Call ${name}(?:$|\\s)`) })
const profileCall = (page, name = 'Maya Chen') => page.locator('.profile').getByRole('link', { name: new RegExp(`^Call ${name}(?:$|\\s)`) })
const snapshot = (page) => page.evaluate(() => window.__callModelSnapshot())

async function enterDemo(page) {
  await page.goto(origin)
  await page.getByRole('button', { name: /Alex Morgan/ }).click()
  await expect(page.getByRole('button', { name: 'Maya Chen', exact: true }).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof window.__callModelSnapshot)).toBe('function')
  assert.equal(await page.evaluate(() => window.__callInterceptInstalled), true, 'dialer interception must be installed before any interaction')
}

async function expectUnchangedModel(page, before) {
  assert.deepEqual(await snapshot(page), before, 'telephone action must not mutate leads, consent, messages, call/activity logs, appointments, or trash')
}

async function expectNoPinOrProfile(page) {
  await expect(page.locator('.profile')).toHaveCount(0)
  await expect(page.locator('.lead-row-pinned')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Close pinned/ })).toHaveCount(0)
  await expect(leadCard(page)).toBeVisible()
}

async function activateSafely(page, context, link, method = 'tap', href = mayaHref) {
  await expect(link).toHaveAttribute('href', href)
  const before = await snapshot(page)
  const url = page.url()
  const pages = context.pages().length
  const count = await page.evaluate(() => window.__interceptedCalls.length)
  assert.equal(await page.evaluate(() => window.__callInterceptInstalled), true)
  if (method === 'keyboard') {
    await link.focus()
    await expect(link).toBeFocused()
    await link.press('Enter')
  } else if (method === 'click') await link.click()
  else await link.tap()
  await expect.poll(() => page.evaluate(() => window.__interceptedCalls.length)).toBe(count + 1)
  assert.deepEqual(await page.evaluate(() => window.__interceptedCalls.at(-1)), { href, prevented: true })
  assert.equal(page.url(), url, 'telephone action must not navigate the CRM')
  assert.equal(context.pages().length, pages, 'telephone action must not open a new browser tab')
  await expectUnchangedModel(page, before)
}

async function expectMobileGeometry(page, link, width) {
  await expect(link).toBeVisible()
  const box = await link.boundingBox()
  assert.ok(box && box.width >= 44 && box.height >= 44, `call target must be at least 44×44px: ${JSON.stringify(box)}`)
  assert.ok(box.x >= 0 && box.x + box.width <= width, `call target must fit the viewport: ${JSON.stringify(box)}`)
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.ok(geometry.scrollWidth <= geometry.viewport, `mobile page must not overflow horizontally: ${JSON.stringify(geometry)}`)
}

async function expectReadableCall(link) {
  await expect.poll(() => link.evaluate((element) => element.getAnimations().filter((animation) =>
    animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity,
  ).length)).toBe(0)
  const sample = await link.evaluate((element) => {
    const parse = (value) => {
      const channels = /^rgba?\(([^)]+)\)$/.exec(value)?.[1].split(',').map(Number)
      if (!channels || (channels[3] ?? 1) !== 1) throw new Error(`Expected an opaque computed call-button color: ${value}`)
      return channels.slice(0, 3)
    }
    const luminance = (rgb) => rgb.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const style = getComputedStyle(element)
    const foreground = luminance(parse(style.color)), background = luminance(parse(style.backgroundColor))
    return { foreground: style.color, background: style.backgroundColor, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) }
  })
  assert.ok(sample.ratio >= 4.5, `call-label contrast must be at least 4.5:1: ${JSON.stringify(sample)}`)
}

async function openProfile(page, name = 'Maya Chen') {
  await leadCard(page, name).getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.profile .pname')).toHaveText(name)
}

async function screenshot(locator, path) {
  await expect.poll(() => locator.page().evaluate(() => document.getAnimations().filter((animation) =>
    animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity,
  ).length)).toBe(0)
  await locator.screenshot({ path, animations: 'disabled' })
}

try {
  await mkdir('test-results', { recursive: true })
  await server.listen()
  browser = await chromium.launch({ headless: true })

  for (const [width, mode, accent] of [
    [390, 'light', null], [320, 'dark', null], [320, 'light', '#AABBCC'], [390, 'dark', '#D69B38'],
  ]) {
    await scenario(`${width}px ${mode}${accent ? ' custom accent' : ''}: card and profile calls preserve CRM state`, async (page, context) => {
      await enterDemo(page)
      const before = await snapshot(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
      if (accent) assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()), accent)
      const call = cardCall(page)
      await expectMobileGeometry(page, call, width)
      await expectReadableCall(call)
      await screenshot(leadCard(page), `test-results/call-card-${mode}-${width}${accent ? '-custom' : ''}.png`)
      await activateSafely(page, context, call)
      await expectNoPinOrProfile(page)
      await activateSafely(page, context, call, 'click')
      await expectNoPinOrProfile(page)
      await openProfile(page)
      await expectMobileGeometry(page, profileCall(page), width)
      await expectReadableCall(profileCall(page))
      await activateSafely(page, context, profileCall(page))
      await expect(page.locator('.profile .pname')).toHaveText('Maya Chen')
      await screenshot(page.locator('.profile > .pcard').first(), `test-results/call-profile-${mode}-${width}${accent ? '-custom' : ''}.png`)
      await expectUnchangedModel(page, before)
    }, { width, mode, accent })
  }

  await scenario('call links are keyboard focusable, visibly focused, and do not select a card', async (page, context) => {
    await enterDemo(page)
    const call = cardCall(page)
    await call.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(call).toBeFocused()
    const focus = await call.evaluate((element) => {
      const style = getComputedStyle(element)
      return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    assert.ok(focus.visible && focus.outline !== 'none' && focus.width >= 2, `keyboard focus must be visible: ${JSON.stringify(focus)}`)
    await expectMobileGeometry(page, call, 320)
    await activateSafely(page, context, call, 'keyboard')
    await expectNoPinOrProfile(page)
    await openProfile(page)
    await activateSafely(page, context, profileCall(page), 'keyboard')
    await expect(page.locator('.profile .pname')).toHaveText('Maya Chen')
  }, { width: 320 })

  await scenario('profile calls use the saved phone, never an unsaved phone draft', async (page, context) => {
    await enterDemo(page)
    const before = await snapshot(page)
    await openProfile(page)
    // Complete profile/activity requests settle before editing the local form.
    await expect(page.getByText('Shared proposal and two project options. Decision expected next week.', { exact: true })).toBeVisible()
    const phone = page.locator('.sec-basic .field').filter({ has: page.locator('label', { hasText: /^Phone$/ }) }).locator('input')
    await expect(phone).toHaveValue('+12025550101')
    for (const draft of ['+442079460123', '', 'javascript:alert(1)']) {
      await phone.fill(draft)
      await expect(phone).toHaveValue(draft)
      await activateSafely(page, context, profileCall(page))
      await expect(phone).toHaveValue(draft)
      await expect(page.locator('.profile .pcontact').first()).toContainText('+12025550101')
    }
    await expectUnchangedModel(page, before)
  })

  await scenario('missing and unsafe saved phones produce no card or profile call link', async (page) => {
    await enterDemo(page)
    const before = await snapshot(page)
    for (const name of ['Noah Patel', 'Sofia Garcia', 'Liam Wilson']) {
      const card = leadCard(page, name)
      await expect(card).toBeVisible()
      await expect(card.locator('.lead-call-btn')).toHaveCount(0)
      await openProfile(page, name)
      await expect(page.locator('.profile .lead-call-btn')).toHaveCount(0)
      await page.getByRole('button', { name: /^Back to / }).click()
      await expect(card).toBeVisible()
    }
    await expect(cardCall(page)).toHaveAttribute('href', mayaHref)
    assert.deepEqual(await page.evaluate(() => window.__interceptedCalls), [])
    await expectUnchangedModel(page, before)
  }, { width: 320, phones: { 'Noah Patel': '', 'Sofia Garcia': 'javascript:alert(1)', 'Liam Wilson': '*21*+12025550106#' } })

  await scenario('desktop stays unchanged and the call action appears only at the mobile breakpoint', async (page) => {
    await enterDemo(page)
    await expect(page.getByRole('link', { name: /^Call / })).toHaveCount(0)
    await page.setViewportSize({ width: 861, height: 1000 })
    await expect(page.getByRole('link', { name: /^Call / })).toHaveCount(0)
    await page.setViewportSize({ width: 860, height: 1000 })
    await expect(cardCall(page)).toBeVisible()
    await openProfile(page)
    await expect(profileCall(page)).toBeVisible()
    await page.setViewportSize({ width: 861, height: 1000 })
    await expect(page.locator('.profile .lead-call-btn')).toBeHidden()
    await page.setViewportSize({ width: 1360, height: 1000 })
    await expect(page.locator('.profile .lead-call-btn')).toBeHidden()
    await expect(page.locator('.profile .pcontact').first()).toContainText('+12025550101')
    assert.deepEqual(await page.evaluate(() => window.__interceptedCalls), [])
  }, { width: 1360 })

  console.log(`${passed} mobile call browser scenarios passed. All telephone activations were intercepted; no dialer was opened.`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
