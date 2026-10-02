import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  canOfferWhatsAppConsentGrant,
  canOfferWhatsAppOptOut,
  explicitWhatsAppConsent,
  leadCreatedWhatsAppNotice,
  newWhatsappClientRequestId,
  normalizeWhatsAppPhone,
  normalizeRecordPhone,
  safeWhatsappCancellationDetail,
  shouldRotateWhatsAppConsentRequest,
  whatsappConsentIsActive,
  whatsappSendNotice,
  WHATSAPP_CONSENT_CONFIRMATION,
  WHATSAPP_EXISTING_LEAD_ATTESTATION,
  WHATSAPP_STAFF_ATTESTATION_HELP,
  WHATSAPP_STAFF_ATTESTATION_TITLE,
} from '../src/lib/whatsappSafety.js'
import { can } from '../src/lib/auth.js'

const messagesSource = await readFile(new URL('../src/components/Messages.jsx', import.meta.url), 'utf8')
const leadProfileSource = await readFile(new URL('../src/components/LeadProfile.jsx', import.meta.url), 'utf8')

const functionSection = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `${startMarker} must exist`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `${endMarker} must exist after ${startMarker}`)
  return source.slice(start, end)
}

test('new-lead consent is enabled only by an explicit checked boolean', () => {
  assert.equal(explicitWhatsAppConsent(true), true)
  assert.equal(explicitWhatsAppConsent(false), false)
  assert.equal(explicitWhatsAppConsent(undefined), false)
  assert.equal(explicitWhatsAppConsent('true'), false)
})

test('WhatsApp client request ids are valid UUIDs', () => {
  assert.match(newWhatsappClientRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
})

test('WhatsApp consent requires a normalized deliverable phone number', () => {
  assert.equal(normalizeWhatsAppPhone('72900 07215'), '+917290007215')
  assert.equal(normalizeWhatsAppPhone('+91 72900-07215'), '+917290007215')
  assert.equal(normalizeWhatsAppPhone('0091 72900 07215'), '+917290007215')
  assert.equal(normalizeWhatsAppPhone('+1 (415) 555-2671'), '+14155552671')
  assert.equal(normalizeWhatsAppPhone('12345'), '')
  assert.equal(normalizeWhatsAppPhone('72900 07215 ext 2'), '')
})

test('local phone numbers use the workspace calling code and explicit prefixes win', () => {
  assert.equal(normalizeWhatsAppPhone('(202) 555-0101', '1'), '+12025550101')
  assert.equal(normalizeWhatsAppPhone('1 202 555 0101', '1'), '+12025550101')
  assert.equal(normalizeWhatsAppPhone('020 7946 0958', '44'), '+442079460958')
  assert.equal(normalizeWhatsAppPhone('+91 72900 07215', '44'), '+917290007215')
  assert.equal(normalizeWhatsAppPhone('123', '44'), '')
  assert.equal(normalizeWhatsAppPhone('2025550101', 'invalid'), '')
  assert.equal(normalizeWhatsAppPhone('0044 20 7946 0958', '1'), '+442079460958')
  assert.equal(normalizeWhatsAppPhone('+1 202 555 0181', '44'), '+12025550181')
})

test('saving phone fields normalizes US and UK recipients without granting messaging consent', () => {
  const cases = [
    ['2025550181', '1', '+12025550181'],
    ['7290007215', '1', '+17290007215'],
    ['020 7946 0958', '44', '+442079460958'],
    ['+91 72900 07215', '1', '+917290007215'],
    ['0044 20 7946 0958', '1', '+442079460958'],
  ]
  for (const [phone, countryCode, expected] of cases) {
    const draft = { name: 'Maya', phone, consentWhatsapp: false }
    const fields = normalizeRecordPhone(draft, countryCode)
    assert.equal(fields.phone, expected)
    assert.equal(fields.consentWhatsapp, false)
    assert.equal(draft.phone, phone, 'normalization does not mutate the editor draft')
    const edit = normalizeRecordPhone({ phone }, countryCode)
    assert.equal(edit.phone, expected)
    assert.ok(!Object.hasOwn(edit, 'consentWhatsapp'))
  }
})

test('saving non-deliverable contact phones preserves raw details without making them WhatsApp recipients', () => {
  for (const phone of ['123', '020 7946 0958 ext 2', 'office: 02079460958']) {
    const fields = normalizeRecordPhone({ phone, consentWhatsapp: false }, '44')
    assert.equal(fields.phone, phone)
    assert.equal(fields.consentWhatsapp, false)
    assert.equal(normalizeWhatsAppPhone(fields.phone, '44'), '')
  }
  assert.deepEqual(normalizeRecordPhone({ phone: '' }, '1'), { phone: '' })
  assert.deepEqual(normalizeRecordPhone({ name: 'Maya' }, '1'), { name: 'Maya' })
})

test('expected recipients require an explicit international prefix instead of a default country guess', () => {
  assert.equal(normalizeWhatsAppPhone('2025550181', ''), '')
  assert.equal(normalizeWhatsAppPhone('+12025550181', ''), '+12025550181')
  assert.equal(normalizeWhatsAppPhone('00442079460958', ''), '+442079460958')
})

test('CRM checkbox copy records a staff attestation, not a patient click', () => {
  assert.match(WHATSAPP_STAFF_ATTESTATION_TITLE, /^I confirm/)
  assert.match(WHATSAPP_STAFF_ATTESTATION_HELP, /staff attestation/i)
  assert.doesNotMatch(WHATSAPP_STAFF_ATTESTATION_HELP, /lead clicked/i)
})

test('Add Lead reports the exact WhatsApp welcome outcome', () => {
  assert.deepEqual(leadCreatedWhatsAppNotice({ hasPhone: false }), {
    message: 'Lead added', error: false,
  })
  assert.match(leadCreatedWhatsAppNotice({ hasPhone: true, consentRequested: false }).message, /remains off/)
  assert.match(leadCreatedWhatsAppNotice({
    hasPhone: true, consentRequested: true, welcomeQueued: true, welcomeStatus: 'queued',
  }).message, /queued/)
  assert.match(leadCreatedWhatsAppNotice({
    hasPhone: true, consentRequested: true, welcomeStatus: 'unknown',
  }).message, /unknown/)
  assert.match(leadCreatedWhatsAppNotice({
    hasPhone: true, consentRequested: true, welcomeStatus: 'suppressed',
  }).message, /reply START/)
  assert.match(leadCreatedWhatsAppNotice({
    hasPhone: true, consentRequested: true, welcomeStatus: 'unexpected_internal_state',
  }).message, /could not be confirmed/)
})

test('inactive consent cancellation gets a clear allowlisted explanation', () => {
  assert.equal(safeWhatsappCancellationDetail({
    status: 'cancelled',
    error_code: 'consent_inactive',
  }), 'Not sent because WhatsApp consent is not active.')
})

test('unknown cancellation details are not exposed to the browser', () => {
  assert.equal(safeWhatsappCancellationDetail({
    status: 'cancelled',
    error_code: 'unexpected_internal_code',
    error_detail: 'Bearer secret-token https://provider.example/phone-number',
  }), 'Cancelled before sending.')
})

test('manual sends report the durable outbox state instead of claiming every request was sent', () => {
  assert.deepEqual(whatsappSendNotice({ status: 'queued' }), {
    message: 'WhatsApp message queued.', error: false,
  })
  assert.deepEqual(whatsappSendNotice({ status: 'unknown' }), {
    message: 'Delivery is unknown. It will not be resent automatically.', error: true,
  })
  assert.deepEqual(whatsappSendNotice({ status: 'cancelled', error_code: 'consent_inactive' }), {
    message: 'Not sent because WhatsApp consent is not active.', error: true,
  })
  assert.equal(whatsappSendNotice({ status: 'failed' }).error, true)
})

test('stop action is offered only for active, verified consent', () => {
  const active = { loading: false, error: '', suppressed: false, consentWhatsapp: true }
  assert.equal(canOfferWhatsAppOptOut(active), true)
  assert.equal(canOfferWhatsAppOptOut({ ...active, consentWhatsapp: false }), false)
  assert.equal(canOfferWhatsAppOptOut({ ...active, suppressed: true }), false)
  assert.equal(canOfferWhatsAppOptOut({ ...active, loading: true }), false)
  assert.equal(canOfferWhatsAppOptOut({ ...active, error: 'unavailable' }), false)
})

test('existing-lead consent is offered only when inactive and unsuppressed', () => {
  const inactive = { loading: false, error: '', suppressed: false, consentWhatsapp: false }
  assert.equal(canOfferWhatsAppConsentGrant(inactive), true)
  assert.equal(canOfferWhatsAppConsentGrant({ ...inactive, suppressed: true }), false)
  assert.equal(canOfferWhatsAppConsentGrant({ ...inactive, consentWhatsapp: true }), false)
  assert.equal(canOfferWhatsAppConsentGrant({ ...inactive, loading: true }), false)
  assert.equal(canOfferWhatsAppConsentGrant({ ...inactive, error: 'unavailable' }), false)
})

test('a consent success is trusted only when the final recipient projection is active', () => {
  const active = {
    loading: false,
    error: '',
    recipientE164: '+917982004015',
    suppressed: false,
    consentWhatsapp: true,
  }
  assert.equal(whatsappConsentIsActive(active), true)
  assert.equal(whatsappConsentIsActive({ ...active, consentWhatsapp: false }), false)
  assert.equal(whatsappConsentIsActive({ ...active, suppressed: true }), false)
  assert.equal(whatsappConsentIsActive({ ...active, recipientE164: null }), false)
  assert.equal(whatsappConsentIsActive({ ...active, loading: true }), false)
  assert.equal(shouldRotateWhatsAppConsentRequest('consent_not_active'), true)
  assert.equal(shouldRotateWhatsAppConsentRequest('recipient_start_required'), true)
  assert.equal(shouldRotateWhatsAppConsentRequest('network_timeout'), false)

  for (const source of [messagesSource, leadProfileSource]) {
    const stop = functionSection(source, 'const stopWhatsApp = async', 'const recordWhatsAppConsent = async')
    const record = functionSection(source, 'const recordWhatsAppConsent = async', 'const replyTo =')
    assert.doesNotMatch(stop, /shouldRotateWhatsAppConsentRequest/)
    assert.match(record, /const result = await recordLeadWhatsAppConsent/)
    assert.match(record, /result\?\.preference/)
    assert.match(record, /if \(!whatsappConsentIsActive\(nextPreference\)\)/)
    assert.match(record, /shouldRotateWhatsAppConsentRequest\(error\.code\)/)
    assert.ok(record.indexOf('whatsappConsentIsActive(nextPreference)') < record.indexOf("notify('WhatsApp consent recorded."))
  }
})

test('existing-lead consent uses the exact audited confirmation and manager permission', () => {
  assert.equal(WHATSAPP_CONSENT_CONFIRMATION, 'I CONFIRM WHATSAPP CONSENT')
  assert.match(WHATSAPP_EXISTING_LEAD_ATTESTATION, /personally confirmed/i)
  assert.equal(can({ role: 'admin' }, 'messages.recordConsent'), true)
  assert.equal(can({ role: 'sub-admin' }, 'messages.recordConsent'), true)
  assert.equal(can({ role: 'coordinator' }, 'messages.recordConsent'), false)
  assert.equal(can({ role: 'reception' }, 'messages.recordConsent'), false)
  assert.equal(can({ role: 'marketing' }, 'messages.recordConsent'), false)
})
