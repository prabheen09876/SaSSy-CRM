// Run with: npm run test:theme
// Exercises the real demo app, including React StrictMode. Every nonlocal
// request is blocked; no live account or business data is read or changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'

const port = 5203
const origin = `http://127.0.0.1:${port}`
const themeKey = 'workspace-crm.theme'
const server = await createServer({
  configFile: 'vite.config.js',
  define: { 'import.meta.env.VITE_CRM_MODE': JSON.stringify('demo') },
  server: { host: '127.0.0.1', port, strictPort: true },
})

let browser
let passed = 0
async function scenario(name, run, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 }, colorScheme: 'light', serviceWorkers: 'block', ...options,
  })
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const errors = []
  context.on('page', (page) => {
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => errors.push(error.message))
  })
  await context.addInitScript((expectedOrigin) => {
    if (location.origin !== expectedOrigin) return
    localStorage.setItem('crm.workspace.v1', JSON.stringify({
      name: 'Northstar Studio', industry: 'general', currency: 'USD', countryCode: '1', setupComplete: true,
    }))
  }, origin)
  const page = await context.newPage()
  try {
    await run(page, context)
    assert.deepEqual(errors, [], 'no browser runtime errors')
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`, { runtimeErrors: errors, pageText: (await page.locator('body').innerText()).slice(0, 2000) })
    await page.screenshot({ path: 'test-results/theme-failure.png', fullPage: true, animations: 'disabled' }).catch(() => {})
    throw error
  } finally { await context.close() }
}

async function openAppearance(page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Appearance', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Follow device', exact: true })).toBeVisible()
}

async function enterDemo(page, name = 'Alex Morgan') {
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await openAppearance(page)
}

const radio = (page, name) => page.getByRole('radio', { name, exact: true })
const themeOption = (page, name) => page.locator('label').filter({ has: radio(page, name) })
const selectTheme = (page, name) => themeOption(page, name).click()
const storedTheme = (page) => page.evaluate((key) => localStorage.getItem(key), themeKey)
const browserColor = (page) => page.locator('meta[name="theme-color"]').getAttribute('content')

async function waitForTransitions(page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
    animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity,
  ).length), { message: 'finite transitions finish before visual checks' }).toBe(0)
}

async function settledScreenshot(page, path) {
  await waitForTransitions(page)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
}

async function expectNoHorizontalOverflow(page, width) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    header: [...document.querySelectorAll('.topbar, .topbar > *, .topbar .who > *')].filter((element) => element.getClientRects().length).map((element) => {
      const { x, width, right } = element.getBoundingClientRect()
      return { element: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`, x, width, right }
    }),
  }))
  assert.ok(geometry.scrollWidth <= geometry.viewport, `${width}px mobile page must not overflow horizontally: ${JSON.stringify(geometry)}`)
}

async function expectReadableThemeLabels(page, theme) {
  await waitForTransitions(page)
  const samples = await page.evaluate(() => {
    const parseColor = (value) => {
      const match = /^rgba?\(([^)]+)\)$/.exec(value)
      if (!match) throw new Error(`Unsupported computed color: ${value}`)
      const values = match[1].split(',').map(Number)
      return [...values.slice(0, 3), values[3] ?? 1]
    }
    const composite = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3])
      return [...front.slice(0, 3).map((channel, index) =>
        alpha ? (channel * front[3] + back[index] * back[3] * (1 - front[3])) / alpha : 0), alpha]
    }
    const background = (element) => {
      let result = [0, 0, 0, 0]
      for (let node = element; node; node = node.parentElement) {
        result = composite(result, parseColor(getComputedStyle(node).backgroundColor))
        if (result[3] === 1) break
      }
      return composite(result, [255, 255, 255, 1])
    }
    const luminance = (color) => color.slice(0, 3).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const targets = [
      ['normal main navigation', '.tabs .tab[aria-selected="false"]'],
      ['active main navigation', '.tabs .tab[aria-selected="true"]'],
      ['selected theme label', '.theme-option input:checked + .theme-option-body .theme-option-title strong'],
    ]
    return targets.map(([name, selector]) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing contrast target: ${name}`)
      const style = getComputedStyle(element)
      const back = background(element)
      const front = composite(parseColor(style.color), back)
      const a = luminance(front), b = luminance(back)
      return { name, foreground: style.color, background: back.slice(0, 3), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    })
  })
  console.log(`CONTRAST ${theme}: ${samples.map((sample) => `${sample.name} ${sample.ratio.toFixed(2)}:1 (${sample.foreground} on rgb(${sample.background.join(', ')}))`).join('; ')}`)
  for (const sample of samples) assert.ok(sample.ratio >= 4.5, `${theme} ${sample.name} contrast must be at least 4.5:1, got ${sample.ratio.toFixed(2)}:1`)
}

async function expectTheme(page, theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe(theme)
  await expect(page.getByRole('button', {
    name: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', exact: true,
  })).toBeVisible()
  assert.match(await browserColor(page), /^#[\da-f]{6}$/i, 'browser chrome has a valid theme color')
}

try {
  await mkdir('test-results', { recursive: true })
  await server.listen()
  browser = await chromium.launch({ headless: true })

  await scenario('explicit dark and light persist across reload and override the device', async (page) => {
    await enterDemo(page)
    await expectTheme(page, 'light')
    const lightColor = await browserColor(page)
    await selectTheme(page, 'Dark')
    await expectTheme(page, 'dark')
    assert.equal(await storedTheme(page), 'dark')
    const darkColor = await browserColor(page)
    assert.notEqual(darkColor, lightColor, 'browser chrome updates with the selected theme')
    await expectReadableThemeLabels(page, 'dark')
    await settledScreenshot(page, 'test-results/theme-appearance-dark-desktop.png')

    await page.reload()
    await expectTheme(page, 'dark')
    assert.equal(await browserColor(page), darkColor)
    await openAppearance(page)
    await expect(radio(page, 'Dark')).toBeChecked()

    await selectTheme(page, 'Light')
    await expectTheme(page, 'light')
    assert.equal(await storedTheme(page), 'light')
    assert.equal(await browserColor(page), lightColor)
    await expectReadableThemeLabels(page, 'light')
    await settledScreenshot(page, 'test-results/theme-appearance-light-desktop.png')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expectTheme(page, 'light')
    await openAppearance(page)
    await expect(radio(page, 'Light')).toBeChecked()
  })

  await scenario('the default and Follow device react to operating-system changes', async (page) => {
    await enterDemo(page)
    await expect(radio(page, 'Follow device')).toBeChecked()
    await expectTheme(page, 'dark')
    const darkColor = await browserColor(page)
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light')
    await expect(radio(page, 'Follow device')).toBeChecked()
    assert.notEqual(await browserColor(page), darkColor)

    await selectTheme(page, 'Dark')
    await selectTheme(page, 'Follow device')
    assert.equal(await storedTheme(page), 'system')
    await expectTheme(page, 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'dark')
    assert.equal(await browserColor(page), darkColor)
    await page.reload()
    await openAppearance(page)
    await expect(radio(page, 'Follow device')).toBeChecked()
    await expectTheme(page, 'dark')
  }, { colorScheme: 'dark' })

  await scenario('the header toggle and Appearance radios stay synchronized', async (page) => {
    await enterDemo(page)
    await expect(radio(page, 'Follow device')).toBeChecked()
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
    await expect(radio(page, 'Dark')).toBeChecked()
    await expectTheme(page, 'dark')
    assert.equal(await storedTheme(page), 'dark')
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
    await expect(radio(page, 'Light')).toBeChecked()
    await expectTheme(page, 'light')
    assert.equal(await storedTheme(page), 'light')
    await radio(page, 'Light').focus()
    await radio(page, 'Light').press('ArrowRight')
    await expect(radio(page, 'Dark')).toBeFocused()
    await expect(radio(page, 'Dark')).toBeChecked()
    await expectTheme(page, 'dark')
    await radio(page, 'Dark').press('ArrowRight')
    await expect(radio(page, 'Follow device')).toBeFocused()
    await expect(radio(page, 'Follow device')).toBeChecked()
    await expectTheme(page, 'light')
    await radio(page, 'Follow device').press('ArrowLeft')
    await expect(radio(page, 'Dark')).toBeFocused()
    await expect(radio(page, 'Dark')).toBeChecked()
    await expectTheme(page, 'dark')
    await selectTheme(page, 'Light')
    await radio(page, 'Dark').focus()
    await radio(page, 'Dark').press('Space')
    await expect(radio(page, 'Dark')).toBeChecked()
    await page.getByRole('tab', { name: 'Leads', exact: true }).click()
    await expectTheme(page, 'dark')
    await page.locator('.topbar').getByRole('button', { name: 'Add lead', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectTheme(page, 'dark')
    await settledScreenshot(page, 'test-results/theme-add-lead-dark-desktop.png')
    await page.getByRole('dialog').press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openAppearance(page)
    await expect(radio(page, 'Dark')).toBeChecked()
  })

  await scenario('real cross-tab storage changes and removal restore each device preference', async (page, context) => {
    await enterDemo(page)
    const other = await context.newPage()
    await other.goto(origin)
    await openAppearance(other)
    await selectTheme(other, 'Dark')
    await expectTheme(page, 'dark')
    await expect(radio(page, 'Dark')).toBeChecked()
    await selectTheme(other, 'Light')
    await expectTheme(page, 'light')
    await expect(radio(page, 'Light')).toBeChecked()

    await page.emulateMedia({ colorScheme: 'dark' })
    await other.evaluate((key) => localStorage.removeItem(key), themeKey)
    await expect(radio(page, 'Follow device')).toBeChecked()
    await expectTheme(page, 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light')

    await selectTheme(page, 'Light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await other.evaluate(() => localStorage.clear())
    await expect(radio(page, 'Follow device')).toBeChecked()
    await expectTheme(page, 'dark')
    assert.equal(await storedTheme(page), null, 'clearing storage must not reinsert an explicit theme')
  })

  await scenario('unavailable browser storage does not prevent applying a theme', async (page) => {
    await enterDemo(page)
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Storage is unavailable for this test.', 'SecurityError') },
      })
    })
    await selectTheme(page, 'Dark')
    await expectTheme(page, 'dark')
    await expect(radio(page, 'Dark')).toBeChecked()
    await expect(page.getByRole('status').filter({ hasText: 'Applied for this visit.' })).toContainText('Applied for this visit. Your browser could not save the preference.')
    await selectTheme(page, 'Light')
    await expectTheme(page, 'light')
    await selectTheme(page, 'Follow device')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'dark')
    await expect(radio(page, 'Follow device')).toBeChecked()
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
    await expectTheme(page, 'light')
    await expect(radio(page, 'Light')).toBeChecked()
  })

  await scenario('marketing staff can use all Appearance choices', async (page) => {
    await enterDemo(page, 'Avery Patel')
    const tabs = page.getByRole('tablist', { name: 'Settings sections' })
    await expect(tabs.getByRole('tab', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: 'Connections', exact: true })).toHaveCount(0)
    for (const name of ['Light', 'Dark', 'Follow device']) await expect(radio(page, name)).toBeEnabled()
    await selectTheme(page, 'Dark')
    await expectTheme(page, 'dark')
    assert.equal(await storedTheme(page), 'dark')
  })

  await scenario('Appearance stays usable without page overflow at 390px and 320px', async (page) => {
    await enterDemo(page)
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      for (const [name, theme] of [['Dark', 'dark'], ['Light', 'light']]) {
        await selectTheme(page, name)
        await expectTheme(page, theme)
        await waitForTransitions(page)
        await expectNoHorizontalOverflow(page, width)
        for (const label of ['Light', 'Dark', 'Follow device']) {
          await expect(radio(page, label)).toBeVisible()
          const box = await themeOption(page, label).boundingBox()
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${label} control stays within the ${width}px viewport`)
        }
        const size = width === 390 ? 'mobile' : 'mobile-320'
        await settledScreenshot(page, `test-results/theme-appearance-${theme}-${size}.png`)
      }
    }
    // The live SaaS shell adds this button next to Brand. Reproduce only its
    // layout in the demo page; do not create a live account or workspace.
    await page.evaluate(() => {
      const brand = document.querySelector('.topbar .workspace-brand')
      brand.querySelector('.workspace-brand-name').textContent = 'International Research & Creative Services Group'
      const switcher = document.createElement('button')
      switcher.className = 'workspace-switch'
      switcher.type = 'button'
      switcher.setAttribute('aria-label', 'Switch workspace')
      switcher.title = 'Switch workspace'
      switcher.innerHTML = '<span>Switch workspace</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></svg>'
      brand.after(switcher)
    })
    await waitForTransitions(page)
    await expectNoHorizontalOverflow(page, 320)
    for (const name of ['Switch workspace', 'Switch to dark mode', 'Switch user']) {
      const control = page.getByRole('button', { name, exact: true })
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= 320, `${name} stays within the narrow SaaS header`)
    }
    await settledScreenshot(page, 'test-results/theme-long-workspace-mobile-320.png')
  }, { viewport: { width: 390, height: 844 } })

  console.log(`${passed} theme browser scenarios passed.`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
