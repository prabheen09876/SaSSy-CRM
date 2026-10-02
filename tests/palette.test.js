import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  accentTokens,
  isAccentColor,
  normalizeAccent,
} from '../src/lib/palette.js'

const EXPECTED_TOKEN_NAMES = [
  '--accent',
  '--accent-ink',
  '--brand',
  '--brand-fg',
  '--brand-ink',
  '--brand-soft',
  '--brand-strong',
  '--glow',
  '--on-brand',
  '--on-brand-faint',
  '--on-brand-line',
  '--on-brand-muted',
  '--on-brand-soft',
]

const SURFACES = {
  light: ['#F4F6FA', '#FFFFFF', '#F8FAFD'],
  dark: ['#101927', '#172338', '#1D2C43'],
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrast(first, second) {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function assertContrast(foreground, background, message) {
  assert.ok(
    contrast(foreground, background) >= 4.5,
    `${message}: ${foreground} on ${background} has ${contrast(foreground, background).toFixed(2)}:1 contrast`,
  )
}

function compositeRgba(value, background) {
  const match = /^rgba\((\d+), (\d+), (\d+), (0?\.\d+)\)$/.exec(value)
  assert.ok(match, `expected an rgba overlay, received ${value}`)
  const alpha = Number(match[4])
  const overlay = match.slice(1, 4).map(Number)
  const base = background.slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16))
  return `#${base.map((channel, index) => Math.round(
    (overlay[index] * alpha) + (channel * (1 - alpha)),
  ).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function assertHeaderContrast(tokens, label) {
  const softBackground = compositeRgba(tokens['--on-brand-soft'], tokens['--brand'])
  for (const foreground of ['--on-brand', '--on-brand-muted', '--on-brand-faint']) {
    assertContrast(tokens[foreground], tokens['--brand'], `${label} ${foreground} on brand`)
    assertContrast(tokens[foreground], softBackground, `${label} ${foreground} on soft control`)
  }
}

test('exports the six product accent presets in stable display order', () => {
  assert.equal(DEFAULT_ACCENT, '#244878')
  assert.deepEqual(ACCENT_PRESETS, [
    { id: 'blue', label: 'Blue', color: '#244878' },
    { id: 'teal', label: 'Teal', color: '#0F766E' },
    { id: 'violet', label: 'Violet', color: '#7C3AED' },
    { id: 'rose', label: 'Rose', color: '#BE185D' },
    { id: 'amber', label: 'Amber', color: '#B45309' },
    { id: 'graphite', label: 'Graphite', color: '#475569' },
  ])
  assert.ok(Object.isFrozen(ACCENT_PRESETS))
  ACCENT_PRESETS.forEach((preset) => {
    assert.ok(Object.isFrozen(preset))
    assert.equal(normalizeAccent(preset.color), preset.color)
  })
})

test('normalizes only three- and six-digit CSS hex colors', () => {
  assert.equal(normalizeAccent('#abc'), '#AABBCC')
  assert.equal(normalizeAccent('  #0f8  '), '#00FF88')
  assert.equal(normalizeAccent('#a1B2c3'), '#A1B2C3')
  assert.equal(isAccentColor(' #ABC '), true)
  assert.equal(isAccentColor('#A1b2C3'), true)

  for (const value of [
    undefined,
    null,
    123456,
    '',
    '244878',
    '#12',
    '#1234',
    '#12345',
    '#1234567',
    '#12345678',
    'rgb(36 72 120)',
    'url(javascript:alert(1))',
    '#fff; --danger: red',
    '#123456\n--danger:red',
    '#12GG34',
  ]) {
    assert.equal(isAccentColor(value), false, `expected ${String(value)} to be rejected`)
    assert.equal(normalizeAccent(value), DEFAULT_ACCENT)
  }
})

test('the default blue palette remains aligned with the existing product styling', () => {
  assert.deepEqual(accentTokens(DEFAULT_ACCENT, 'light'), {
    '--brand': '#244878',
    '--brand-strong': '#18365E',
    '--brand-ink': '#FFFFFF',
    '--brand-soft': '#E7EEF9',
    '--brand-fg': '#244878',
    '--accent': '#ACC5EA',
    '--accent-ink': '#182B49',
    '--on-brand': '#FFFFFF',
    '--on-brand-muted': '#D0DCEE',
    '--on-brand-faint': '#BDCCE4',
    '--on-brand-soft': 'rgba(255, 255, 255, 0.08)',
    '--on-brand-line': 'rgba(255, 255, 255, 0.22)',
    '--glow': '#E7EEF9',
  })
  assert.equal(accentTokens(DEFAULT_ACCENT, 'dark')['--brand-strong'], '#315F9D')
  assert.equal(accentTokens(DEFAULT_ACCENT, 'dark')['--brand-fg'], '#A8C8F7')
  assert.equal(accentTokens(DEFAULT_ACCENT, 'dark')['--brand-soft'], '#203653')
})

test('palette output is limited to brand variables and invalid modes fall back to light', () => {
  const light = accentTokens('#0F766E', 'light')
  assert.deepEqual(Object.keys(light).sort(), EXPECTED_TOKEN_NAMES)
  assert.deepEqual(accentTokens('#0F766E', 'sepia'), light)
  assert.equal(Object.hasOwn(light, '--bg'), false)
  assert.equal(Object.hasOwn(light, '--surface'), false)
  assert.equal(Object.hasOwn(light, '--success'), false)
  assert.equal(Object.hasOwn(light, '--warning'), false)
  assert.equal(Object.hasOwn(light, '--danger'), false)
})

test('all presets produce accessible brand, hover, foreground and chip text in both modes', () => {
  for (const { label, color } of ACCENT_PRESETS) {
    for (const mode of ['light', 'dark']) {
      const tokens = accentTokens(color, mode)
      assert.equal(tokens['--brand'], color)
      assertContrast(tokens['--brand-ink'], tokens['--brand'], `${label} ${mode} brand ink`)
      assertContrast(tokens['--brand-ink'], tokens['--brand-strong'], `${label} ${mode} hover ink`)
      assertContrast(tokens['--accent-ink'], tokens['--accent'], `${label} ${mode} chip ink`)
      assertHeaderContrast(tokens, `${label} ${mode}`)
      for (const surface of [...SURFACES[mode], tokens['--brand-soft']]) {
        assertContrast(tokens['--brand-fg'], surface, `${label} ${mode} brand foreground`)
      }
    }
  }
})

test('extreme custom colors remain accessible and preserve the exact normalized brand fill', () => {
  const colors = ['#FFFFFF', '#000000', '#FFFF00', '#777777']
  for (const color of colors) {
    for (const mode of ['light', 'dark']) {
      const tokens = accentTokens(color, mode)
      assert.equal(tokens['--brand'], color, `${color} ${mode} brand fill`)
      assert.match(tokens['--brand-ink'], /^#[0-9A-F]{6}$/)
      assert.match(tokens['--brand-strong'], /^#[0-9A-F]{6}$/)
      assertContrast(tokens['--brand-ink'], color, `${color} ${mode} brand ink`)
      assertContrast(tokens['--brand-ink'], tokens['--brand-strong'], `${color} ${mode} hover ink`)
      assertContrast(tokens['--accent-ink'], tokens['--accent'], `${color} ${mode} chip ink`)
      assertHeaderContrast(tokens, `${color} ${mode}`)
      for (const surface of [...SURFACES[mode], tokens['--brand-soft']]) {
        assertContrast(tokens['--brand-fg'], surface, `${color} ${mode} brand foreground`)
      }
    }
  }
})

test('hostile custom input cannot escape into emitted CSS values', () => {
  for (const input of ['#fff; color:red', '#000000;background:url(x)', 'var(--danger)', '</style>']) {
    const tokens = accentTokens(input, 'dark')
    assert.equal(tokens['--brand'], DEFAULT_ACCENT)
    Object.values(tokens).forEach((value) => {
      assert.doesNotMatch(value, /[;{}<>]|url|var\(/i)
      assert.match(value, /^(?:#[0-9A-F]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.\d+\))$/)
    })
  }
})
