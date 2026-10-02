const PHONE_FORMAT = /^\+?[0-9 ().-]+$/
const NATIONAL_DIGITS = /^\d{7,15}$/
const INTERNATIONAL_DIGITS = /^[1-9]\d{6,14}$/

// Build a click-to-call target without guessing a country. This intentionally
// stays separate from WhatsApp recipient normalization: local mobile and
// landline numbers are valid voice-call destinations for the user's device.
export function telephoneHref(value) {
  let raw
  if (typeof value === 'string') raw = value
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) raw = String(value)
  else return ''

  // Only ordinary spaces are formatting. Control characters can concatenate
  // separate values in markup or obscure an unintended destination.
  if (!raw || /[\r\n\t\f\v]/.test(raw)) return ''
  raw = raw.trim()
  if (!raw || !PHONE_FORMAT.test(raw)) return ''
  // Two already dialable digit runs are separate destinations, not benign
  // grouping. Ordinary formats such as 202 555 0181 remain accepted.
  if ((raw.match(/\d{7,}/g) || []).length > 1) return ''

  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  const hasInternationalAccessCode = !hasPlus && digits.startsWith('00')

  if (hasPlus) {
    if (!INTERNATIONAL_DIGITS.test(digits) || /^0+$/.test(digits)) return ''
    return `tel:+${digits}`
  }

  if (hasInternationalAccessCode) {
    const internationalDigits = digits.slice(2)
    if (!INTERNATIONAL_DIGITS.test(internationalDigits) || /^0+$/.test(internationalDigits)) return ''
    return `tel:+${internationalDigits}`
  }

  if (!NATIONAL_DIGITS.test(digits) || /^0+$/.test(digits)) return ''
  return `tel:${digits}`
}
