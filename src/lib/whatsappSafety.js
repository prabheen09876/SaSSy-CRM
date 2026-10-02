const CANCELLED_MESSAGE_DETAILS = Object.freeze({
  consent_inactive: 'Not sent because WhatsApp consent is not active.',
  recipient_suppressed: 'Not sent because this contact has stopped WhatsApp updates.',
  recipient_opt_out: 'Not sent because this contact has stopped WhatsApp updates.',
  recipient_changed: 'Not sent because the phone number changed after this message was queued.',
  service_window_closed: 'Not sent because the 24-hour reply window closed before dispatch. Use an approved template.',
  template_not_approved: 'Not sent because this template is not approved in the Meta registry.',
  session_recipient_unresolved: 'Not sent because the recipient could not be verified for a session reply.',
  invalid_policy_exception: 'Not sent because this message did not pass the WhatsApp sending policy check.',
})

const cancellationCode = (message) => String(
  message?.error_code
    || message?.error_details?.error_code
    || message?.error_details?.code
    || message?.cancel_reason
    || '',
).trim().toLowerCase()

// Cancellation details are deliberately allowlisted. Provider/debug strings can
// contain phone numbers, request URLs, or credentials and must not reach the UI.
export const safeWhatsappCancellationDetail = (message) => {
  if (String(message?.status || '').toLowerCase() !== 'cancelled') return ''
  return CANCELLED_MESSAGE_DETAILS[cancellationCode(message)]
    || 'Cancelled before sending.'
}

export const whatsappSendNotice = (message) => {
  const status = String(message?.status || '').toLowerCase()
  if (status === 'queued') return { message: 'WhatsApp message queued.', error: false }
  if (status === 'sending') return { message: 'WhatsApp message is already being sent.', error: false }
  if (['accepted', 'sent', 'delivered', 'read'].includes(status)) {
    return { message: `WhatsApp message already ${status}.`, error: false }
  }
  if (status === 'unknown') {
    return { message: 'Delivery is unknown. It will not be resent automatically.', error: true }
  }
  if (status === 'cancelled') {
    return { message: safeWhatsappCancellationDetail(message), error: true }
  }
  if (status === 'failed') return { message: 'WhatsApp message failed. Review its status before sending again.', error: true }
  return { message: 'WhatsApp message status was returned by the server.', error: false }
}

// Consent is fail-closed: only a literal checked boolean enables WhatsApp.
export const explicitWhatsAppConsent = (checked) => checked === true

export const newWhatsappClientRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Explicit international prefixes win; otherwise use the business's dial code.
// The default preserves compatibility for existing callers.
export const normalizeWhatsAppPhone = (value, countryCode = '91') => {
  const raw = String(value || '').trim()
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return ''

  let digits = raw.replace(/\D/g, '')
  const hasInternationalPrefix = raw.startsWith('+') || raw.startsWith('00')
  if (raw.startsWith('00')) digits = digits.slice(2)

  if (!hasInternationalPrefix) {
    const code = String(countryCode || '').replace(/\D/g, '')
    if (!/^[1-9]\d{0,2}$/.test(code)) return ''
    if (code === '91') {
      if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`
      else if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`
      else if (!/^91[6-9]\d{9}$/.test(digits)) return ''
    } else if (code === '1' && /^1\d{10}$/.test(digits)) {
      // A North American number may already include its dial code.
    } else {
      digits = code + digits.replace(/^0/, '')
    }
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return ''
  if (/^91\d{10}$/.test(digits) && !/^91[6-9]/.test(digits)) return ''
  return `+${digits}`
}

// Phone formatting is independent from permission to send messages. Preserve
// extensions and other non-deliverable contact details without inventing consent.
export const normalizeRecordPhone = (fields, countryCode) => {
  if (!Object.hasOwn(fields, 'phone')) return fields
  return {
    ...fields,
    phone: normalizeWhatsAppPhone(fields.phone, countryCode) || String(fields.phone ?? '').trim(),
  }
}

export const WHATSAPP_STAFF_ATTESTATION_TITLE = 'I confirm the lead gave WhatsApp permission'
export const WHATSAPP_STAFF_ATTESTATION_DETAIL =
  'I personally verified their clear permission to receive WhatsApp updates from our business.'
export const WHATSAPP_STAFF_ATTESTATION_HELP =
  'This records your staff attestation; the lead is not clicking this CRM checkbox. An approved welcome may be queued.'

// The Worker and database require this exact phrase. Keep it separate from the
// friendlier on-screen explanation so the audit record has one stable value.
export const WHATSAPP_CONSENT_CONFIRMATION = 'I CONFIRM WHATSAPP CONSENT'
export const WHATSAPP_EXISTING_LEAD_ATTESTATION =
  'I personally confirmed this lead gave our business clear permission to send WhatsApp updates.'

const WELCOME_OUTCOMES = Object.freeze({
  queued: { message: 'Lead added — WhatsApp welcome queued.', error: false },
  sending: { message: 'Lead added — WhatsApp welcome is being sent.', error: false },
  accepted: { message: 'Lead added — Meta accepted the WhatsApp welcome.', error: false },
  sent: { message: 'Lead added — WhatsApp welcome sent.', error: false },
  delivered: { message: 'Lead added — WhatsApp welcome delivered.', error: false },
  read: { message: 'Lead added — WhatsApp welcome read.', error: false },
  consent_inactive: {
    message: 'Lead added — WhatsApp remains off. After a STOP, only the recipient can resume updates by replying START.',
    error: false,
  },
  suppressed: {
    message: 'Lead added — WhatsApp remains stopped. The recipient must reply START before updates can resume.',
    error: false,
  },
  invalid_recipient: {
    message: 'Lead added — WhatsApp welcome was not queued because the phone number is invalid.',
    error: true,
  },
  skipped: { message: 'Lead added — WhatsApp welcome was not queued.', error: false },
  missing: { message: 'Lead added — WhatsApp welcome record was not created.', error: true },
  pending: { message: 'Lead added — WhatsApp welcome is pending and was not queued yet.', error: true },
  unknown: {
    message: 'Lead added — WhatsApp welcome outcome is unknown. Check the message status before retrying.',
    error: true,
  },
  failed: { message: 'Lead added — WhatsApp welcome failed.', error: true },
  exhausted: { message: 'Lead added — WhatsApp welcome failed after repeated attempts.', error: true },
  unavailable: { message: 'Lead added — WhatsApp messaging is unavailable, so no welcome was queued.', error: true },
  cancelled: { message: 'Lead added — WhatsApp welcome was cancelled.', error: true },
})

export const leadCreatedWhatsAppNotice = ({
  hasPhone,
  consentRequested,
  welcomeQueued,
  welcomeStatus,
}) => {
  if (!hasPhone) return { message: 'Lead added', error: false }
  if (!consentRequested) {
    return { message: 'Lead added — WhatsApp remains off because consent was not recorded.', error: false }
  }
  const status = String(welcomeStatus || (welcomeQueued ? 'queued' : '')).trim().toLowerCase()
  return WELCOME_OUTCOMES[status]
    || { message: 'Lead added — WhatsApp welcome status could not be confirmed.', error: true }
}

export const canOfferWhatsAppOptOut = (preference) => Boolean(preference
  && !preference.loading
  && !preference.error
  && !preference.suppressed
  && preference.consentWhatsapp === true)

// Suppressed recipients are intentionally excluded. Staff cannot undo STOP;
// only an authenticated inbound START may clear recipient/provider suppression.
export const canOfferWhatsAppConsentGrant = (preference) => Boolean(preference
  && !preference.loading
  && !preference.error
  && !preference.suppressed
  && preference.consentWhatsapp === false)

// A successful consent mutation is not enough on its own. The CRM enables the
// composer only from the server's final recipient-bound preference projection.
export const whatsappConsentIsActive = (preference) => Boolean(preference
  && !preference.loading
  && !preference.error
  && preference.recipientE164
  && preference.suppressed !== true
  && preference.consentWhatsapp === true)

const DEFINITIVE_CONSENT_RESULTS = new Set([
  'consent_not_active',
  'recipient_changed',
  'recipient_start_required',
  'staff_suppressed',
])

// Reuse an idempotency key only for ambiguous transport failures. A definitive
// policy response may have retained revoked evidence, so the next genuine
// attestation must receive a fresh key.
export const shouldRotateWhatsAppConsentRequest = (code) =>
  DEFINITIVE_CONSENT_RESULTS.has(String(code || ''))
