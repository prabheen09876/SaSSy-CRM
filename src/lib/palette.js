export const DEFAULT_ACCENT = '#244878'

export const ACCENT_PRESETS = Object.freeze([
  Object.freeze({ id: 'blue', label: 'Blue', color: '#244878' }),
  Object.freeze({ id: 'teal', label: 'Teal', color: '#0F766E' }),
  Object.freeze({ id: 'violet', label: 'Violet', color: '#7C3AED' }),
  Object.freeze({ id: 'rose', label: 'Rose', color: '#BE185D' }),
  Object.freeze({ id: 'amber', label: 'Amber', color: '#B45309' }),
  Object.freeze({ id: 'graphite', label: 'Graphite', color: '#475569' }),
])

const HEX_COLOR = /^#[0-9A-F]{3}(?:[0-9A-F]{3})?$/i
const WHITE = '#FFFFFF'
// Nearly black, while retaining enough contrast for the mid-grey boundary
// where pure white falls just short of WCAG AA.
const NEAR_BLACK = '#050505'
const MIN_TEXT_CONTRAST = 4.5

const SURFACES = Object.freeze({
  light: Object.freeze({ surface: '#FFFFFF', surface2: '#F8FAFD', background: '#F4F6FA' }),
  dark: Object.freeze({ surface: '#172338', surface2: '#1D2C43', background: '#101927' }),
})

const DEFAULT_TOKENS = Object.freeze({
  light: Object.freeze({
    '--brand': DEFAULT_ACCENT,
    '--brand-strong': '#18365E',
    '--brand-ink': WHITE,
    '--brand-soft': '#E7EEF9',
    '--brand-fg': DEFAULT_ACCENT,
    '--accent': '#ACC5EA',
    '--accent-ink': '#182B49',
    '--on-brand': WHITE,
    '--on-brand-muted': '#D0DCEE',
    '--on-brand-faint': '#BDCCE4',
    // Eight percent retains the original light control treatment while the
    // faint header copy remains AA-readable on the composited background.
    '--on-brand-soft': 'rgba(255, 255, 255, 0.08)',
    '--on-brand-line': 'rgba(255, 255, 255, 0.22)',
    '--glow': '#E7EEF9',
  }),
  dark: Object.freeze({
    '--brand': DEFAULT_ACCENT,
    '--brand-strong': '#315F9D',
    '--brand-ink': WHITE,
    '--brand-soft': '#203653',
    '--brand-fg': '#A8C8F7',
    '--accent': '#A8C8F7',
    '--accent-ink': '#182B49',
    '--on-brand': WHITE,
    '--on-brand-muted': '#D0DCEE',
    '--on-brand-faint': '#BDCCE4',
    '--on-brand-soft': 'rgba(255, 255, 255, 0.08)',
    '--on-brand-line': 'rgba(255, 255, 255, 0.22)',
    '--glow': '#213A5C',
  }),
})

export function isAccentColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
}

export function normalizeAccent(value) {
  if (!isAccentColor(value)) return DEFAULT_ACCENT
  const color = value.trim().toUpperCase()
  if (color.length === 7) return color
  return `#${color.slice(1).split('').map((character) => character.repeat(2)).join('')}`
}

function channels(hex) {
  const normalized = normalizeAccent(hex)
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

function toHex(rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function mix(from, to, amount) {
  const start = channels(from)
  const end = channels(to)
  return toHex(start.map((channel, index) => channel + ((end[index] - channel) * amount)))
}

function relativeLuminance(hex) {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2])
}

function contrast(foreground, background) {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function readableInk(background) {
  return contrast(NEAR_BLACK, background) >= contrast(WHITE, background) ? NEAR_BLACK : WHITE
}

function ensureContrast(color, backgrounds, target) {
  if (backgrounds.every((background) => contrast(color, background) >= MIN_TEXT_CONTRAST)) return color
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(color, target, step / 100)
    if (backgrounds.every((background) => contrast(candidate, background) >= MIN_TEXT_CONTRAST)) return candidate
  }
  return target
}

function strongBrand(brand, ink) {
  // A darker hover is preferred. Around the grey contrast crossover, a
  // lighter hover is the accessible direction for dark ink.
  const candidates = [mix(brand, '#000000', 0.14), mix(brand, WHITE, 0.14)]
  const immediate = candidates.find((candidate) => candidate !== brand && contrast(ink, candidate) >= MIN_TEXT_CONTRAST)
  if (immediate) return immediate

  const targets = ink === WHITE ? ['#000000', WHITE] : [WHITE, '#000000']
  for (const target of targets) {
    for (let step = 2; step <= 100; step += 2) {
      const candidate = mix(brand, target, step / 100)
      if (candidate !== brand && contrast(ink, candidate) >= MIN_TEXT_CONTRAST) return candidate
    }
  }
  return brand
}

function mutedInk(ink, brand, softBackground, amount) {
  for (let step = Math.round(amount * 100); step >= 0; step -= 1) {
    const candidate = mix(ink, brand, step / 100)
    if ([brand, softBackground].every((background) => contrast(candidate, background) >= MIN_TEXT_CONTRAST)) {
      return candidate
    }
  }
  return ink
}

function translucent(color, alpha) {
  const [red, green, blue] = channels(color)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function composite(overlay, background, alpha) {
  return mix(background, overlay, alpha)
}

export function accentTokens(value, mode = 'light') {
  const brand = normalizeAccent(value)
  const resolvedMode = mode === 'dark' ? 'dark' : 'light'
  if (brand === DEFAULT_ACCENT) return { ...DEFAULT_TOKENS[resolvedMode] }

  const { surface, surface2, background } = SURFACES[resolvedMode]
  const ink = readableInk(brand)
  const brandSoft = resolvedMode === 'dark'
    ? mix(surface2, brand, 0.18)
    : mix(WHITE, brand, 0.10)
  const brandForeground = ensureContrast(
    brand,
    [background, surface, surface2, brandSoft],
    resolvedMode === 'dark' ? WHITE : NEAR_BLACK,
  )
  const accent = mix(brand, WHITE, resolvedMode === 'dark' ? 0.58 : 0.64)
  const accentInk = readableInk(accent)
  // Header controls sit on top of --brand. Shade them away from the text so
  // translucency improves, rather than erodes, foreground contrast.
  const softOverlay = ink === WHITE ? '#000000' : WHITE
  const softBackground = composite(softOverlay, brand, 0.14)

  return {
    '--brand': brand,
    '--brand-strong': strongBrand(brand, ink),
    '--brand-ink': ink,
    '--brand-soft': brandSoft,
    '--brand-fg': brandForeground,
    '--accent': accent,
    '--accent-ink': accentInk,
    '--on-brand': ink,
    '--on-brand-muted': mutedInk(ink, brand, softBackground, 0.18),
    '--on-brand-faint': mutedInk(ink, brand, softBackground, 0.30),
    '--on-brand-soft': translucent(softOverlay, 0.14),
    '--on-brand-line': translucent(ink, 0.22),
    '--glow': resolvedMode === 'dark' ? mix(background, brand, 0.30) : brandSoft,
  }
}
