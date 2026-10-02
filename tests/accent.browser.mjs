// Run with: npm run test:accent
// Real demo UI and StrictMode, with all nonlocal requests blocked. These checks
// never create a live account, send a message, or modify business data.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'

const port = 5204
const origin = `http://127.0.0.1:${port}`
const accentKey = 'workspace-crm.accent'
const themeKey = 'workspace-crm.theme'
const presetNames = ['Blue', 'Teal', 'Violet', 'Rose', 'Amber', 'Graphite']
const server = await createServer({
  configFile: 'vite.config.js',
  define: { 'import.meta.env.VITE_CRM_MODE': JSON.stringify('demo') },
  server: { host: '127.0.0.1', port, strictPort: true },
})

let browser
let passed = 0
async function scenario(name, run, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1100 }, colorScheme: 'light', serviceWorkers: 'block', ...options,
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
    console.error(`FAIL ${name}`, { runtimeErrors: errors, pageText: (await page.locator('body').innerText()).slice(-2600) })
    await page.screenshot({ path: 'test-results/accent-failure.png', fullPage: true, animations: 'disabled' }).catch(() => {})
    throw error
  } finally { await context.close() }
}

const accentGroup = (page) => page.getByRole('group', { name: 'Accent color', exact: true })
const accentRadio = (page, name) => accentGroup(page).getByRole('radio', { name, exact: true })
const accentOption = (page, name) => accentGroup(page).locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) })
const selectAccent = (page, name) => accentOption(page, name).click()
const selectTheme = (page, name) => page.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) }).click()
const readStorage = (page, key) => page.evaluate((key) => localStorage.getItem(key), key)
const currentBrand = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim().toUpperCase())

async function openAppearance(page) {
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Appearance', exact: true }).click()
  await expect(accentGroup(page)).toBeVisible()
}

async function enterDemo(page, name = 'Alex Morgan') {
  await page.goto(origin)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await openAppearance(page)
}

async function waitForTransitions(page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
    animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity,
  ).length), { message: 'finite transitions finish before visual checks' }).toBe(0)
}

async function settledScreenshot(page, path) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await waitForTransitions(page)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
}

async function expectBrand(page, hex) {
  assert.match(hex, /^#[\dA-F]{6}$/, 'accent is a normalized uppercase six-digit hex color')
  await expect.poll(() => currentBrand(page)).toBe(hex)
  if (hex !== '#244878') await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', hex)
  await waitForTransitions(page)
  const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16))
  const expected = `rgb(${rgb.join(', ')})`
  for (const selector of ['.topbar', '.topbar .btn.primary', '.tabs .tab[aria-selected="true"]']) {
    assert.equal(await page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor), expected, `${selector} uses the selected accent`)
  }
}

async function expectReadableAccent(page) {
  await waitForTransitions(page)
  const samples = await page.evaluate(() => {
    const luminance = (rgb) => rgb.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const rgba = (value) => {
      const match = /^rgba?\(([^)]+)\)$/.exec(value)
      if (!match) throw new Error(`Unsupported computed color: ${value}`)
      const channels = match[1].split(',').map(Number)
      return [...channels.slice(0, 3), channels[3] ?? 1]
    }
    const composite = (front, back) => front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3]))
    const contrast = (foreground, background) => {
      const a = luminance(foreground.slice(0, 3)), b = luminance(background.slice(0, 3))
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const samples = ['.topbar .workspace-brand-name', '.topbar .btn.primary', '.tabs .tab[aria-selected="true"]'].map((selector) => {
      const element = document.querySelector(selector)
      const foreground = getComputedStyle(element).color
      const background = getComputedStyle(selector.includes('workspace-brand') ? document.querySelector('.topbar') : element).backgroundColor
      return { selector, foreground, background, ratio: contrast(rgba(foreground), rgba(background)) }
    })
    const search = document.querySelector('.topbar-search')
    const placeholder = getComputedStyle(search.querySelector('input'), '::placeholder')
    const background = composite(rgba(getComputedStyle(search).backgroundColor), rgba(getComputedStyle(document.querySelector('.topbar')).backgroundColor))
    const placeholderColor = rgba(placeholder.color)
    placeholderColor[3] *= Number(placeholder.opacity)
    samples.push({ selector: '.topbar-search input::placeholder', foreground: placeholder.color, background,
      ratio: contrast(composite(placeholderColor, background), background) })
    return samples
  })
  for (const sample of samples) assert.ok(sample.ratio >= 4.5, `${sample.selector} text contrast must be >= 4.5:1: ${JSON.stringify(sample)}`)
}

async function applyHex(page, hex) {
  await selectAccent(page, 'Custom')
  await page.getByLabel('Hex color', { exact: true }).fill(hex)
  await page.getByRole('button', { name: 'Apply color', exact: true }).click()
}

try {
  await mkdir('test-results', { recursive: true })
  await server.listen()
  browser = await chromium.launch({ headless: true })

  await scenario('every palette applies immediately to the header, buttons, and selected navigation', async (page) => {
    await enterDemo(page)
    await expect(accentGroup(page).getByRole('radio')).toHaveCount(7)
    await expect(accentRadio(page, 'Blue')).toBeChecked()
    const colors = new Set()
    // End with Blue so its onChange is exercised too, rather than clicking the
    // already-selected default and expecting a redundant storage write.
    for (const name of [...presetNames.slice(1), presetNames[0]]) {
      await selectAccent(page, name)
      await expect(accentRadio(page, name)).toBeChecked()
      const hex = await readStorage(page, accentKey)
      colors.add(hex)
      await expectBrand(page, hex)
      await expectReadableAccent(page)
    }
    assert.equal(colors.size, presetNames.length, 'each named palette has a distinct accent')
  })

  await scenario('custom hex validation, shorthand normalization, and native color changes', async (page) => {
    await enterDemo(page)
    await selectAccent(page, 'Teal')
    const original = await readStorage(page, accentKey)
    await selectAccent(page, 'Custom')
    for (const value of ['not-a-color', '#12', '#GGGGGG']) {
      await page.getByLabel('Hex color', { exact: true }).fill(value)
      await page.getByRole('button', { name: 'Apply color', exact: true }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      assert.equal(await readStorage(page, accentKey), original, 'invalid text does not replace the saved accent')
      await expectBrand(page, original)
    }
    await applyHex(page, '#abc')
    await expectBrand(page, '#AABBCC')
    assert.equal(await readStorage(page, accentKey), '#AABBCC')
    await expect(accentRadio(page, 'Custom')).toBeChecked()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expectReadableAccent(page)
    const picker = page.getByLabel('Pick a custom color', { exact: true })
    await expect(picker).toHaveAttribute('type', 'color')
    // Native OS color-picker windows are outside the browser test surface.
    // Deliver the same DOM events as selecting a color in that picker.
    await picker.evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#325ad4')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expectBrand(page, '#325AD4')
    assert.equal(await readStorage(page, accentKey), '#325AD4', 'native color change applies without Apply color')
    await expect(accentRadio(page, 'Custom')).toBeChecked()
    await applyHex(page, '#244878')
    await expectBrand(page, '#244878')
    await expect(accentRadio(page, 'Blue')).toBeChecked()
  })

  await scenario('custom accent survives reload, theme choices, header toggles, and device changes', async (page) => {
    await enterDemo(page)
    await applyHex(page, '#C84E74')
    await selectTheme(page, 'Dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expectBrand(page, '#C84E74')
    await page.reload()
    await openAppearance(page)
    await expect(accentRadio(page, 'Custom')).toBeChecked()
    await expectBrand(page, '#C84E74')
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expectBrand(page, '#C84E74')
    await selectTheme(page, 'Follow device')
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      await expectBrand(page, '#C84E74')
      assert.equal(await readStorage(page, accentKey), '#C84E74')
      assert.equal(await readStorage(page, themeKey), 'system')
    }
  })

  await scenario('cross-tab accent updates and removal leave the selected theme intact', async (page, context) => {
    await enterDemo(page)
    const blue = await currentBrand(page)
    await selectTheme(page, 'Dark')
    const other = await context.newPage()
    await other.goto(origin)
    await openAppearance(other)
    await selectAccent(other, 'Violet')
    const violet = await readStorage(other, accentKey)
    await expectBrand(page, violet)
    await expect(accentRadio(page, 'Violet')).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await other.evaluate((key) => localStorage.removeItem(key), accentKey)
    await expectBrand(page, blue)
    await expect(accentRadio(page, 'Blue')).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
    assert.equal(await readStorage(page, themeKey), 'dark')
    assert.equal(await readStorage(page, accentKey), null)
  })

  await scenario('palette keyboard navigation is separate from the theme radio group', async (page) => {
    await enterDemo(page)
    await accentRadio(page, 'Blue').focus()
    await accentRadio(page, 'Blue').press('ArrowRight')
    await expect(accentRadio(page, 'Teal')).toBeFocused()
    await expect(accentRadio(page, 'Teal')).toBeChecked()
    await expectBrand(page, await readStorage(page, accentKey))
    await accentRadio(page, 'Teal').press('ArrowLeft')
    await expect(accentRadio(page, 'Blue')).toBeChecked()
    await accentRadio(page, 'Violet').focus()
    await accentRadio(page, 'Violet').press('Space')
    await expect(accentRadio(page, 'Violet')).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Follow device', exact: true })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  await scenario('marketing staff can choose colors and unavailable storage stays usable', async (page) => {
    await enterDemo(page, 'Avery Patel')
    for (const name of [...presetNames, 'Custom']) await expect(accentRadio(page, name)).toBeEnabled()
    await selectAccent(page, 'Rose')
    const rose = await readStorage(page, accentKey)
    await expectBrand(page, rose)
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Storage is unavailable for this test.', 'SecurityError') },
      })
    })
    await applyHex(page, '#009C8E')
    await expectBrand(page, '#009C8E')
    await expect(page.getByRole('status').filter({ hasText: 'Your browser could not save the color.' }))
      .toContainText('Applied for this visit. Your browser could not save the color.')
    await selectTheme(page, 'Dark')
    await expectBrand(page, '#009C8E')
    await expect(accentRadio(page, 'Custom')).toBeChecked()
  })

  await scenario('teal, violet, and custom colors render legibly in light and dark modes', async (page) => {
    await enterDemo(page)
    for (const mode of ['Light', 'Dark']) {
      await selectTheme(page, mode)
      for (const name of ['Teal', 'Violet', 'Custom']) {
        if (name === 'Custom') await applyHex(page, '#D69B38')
        else await selectAccent(page, name)
        await expectBrand(page, await readStorage(page, accentKey))
        await expectReadableAccent(page)
        await settledScreenshot(page, `test-results/accent-${name.toLowerCase()}-${mode.toLowerCase()}-desktop.png`)
      }
    }
  })

  await scenario('the accent picker and custom controls fit a 320px screen in both modes', async (page) => {
    await enterDemo(page)
    for (const mode of ['Light', 'Dark']) {
      await selectTheme(page, mode)
      await applyHex(page, '#009C8E')
      await expectBrand(page, '#009C8E')
      await waitForTransitions(page)
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
      assert.ok(geometry.scrollWidth <= geometry.viewport, `mobile page must not overflow: ${JSON.stringify(geometry)}`)
      const controls = [
        ...[...presetNames, 'Custom'].map((name) => accentOption(page, name)),
        page.getByLabel('Pick a custom color', { exact: true }), page.getByLabel('Hex color', { exact: true }),
        page.getByRole('button', { name: 'Apply color', exact: true }),
      ]
      for (const control of controls) {
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= 320, 'accent controls stay inside the 320px viewport')
      }
      await settledScreenshot(page, `test-results/accent-custom-${mode.toLowerCase()}-mobile-320.png`)
    }
  }, { viewport: { width: 320, height: 844 } })

  console.log(`${passed} accent browser scenarios passed.`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
