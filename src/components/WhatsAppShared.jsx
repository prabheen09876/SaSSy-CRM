import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadWhatsappMedia,
  loadLeadWhatsAppPreference,
  messageMediaRef,
  messageProviderId,
  messageSafeFailure,
  uploadWhatsappMedia,
} from '../lib/db'
import { channelLabel, messageStatusLabel, messageStatusPill } from '../lib/constants'
import { DEFAULT_WORKSPACE } from '../lib/workspace'
import {
  fillTemplate,
  whatsappTemplateInputVars,
  whatsappTemplateMediaType,
  whatsappTemplateMissingVars,
  whatsappTemplatePayloadVars,
} from '../lib/wa'
import {
  canOfferWhatsAppConsentGrant,
  canOfferWhatsAppOptOut,
  newWhatsappClientRequestId,
  normalizeWhatsAppPhone,
  shouldRotateWhatsAppConsentRequest,
  whatsappConsentIsActive,
  WHATSAPP_CONSENT_CONFIRMATION,
  WHATSAPP_EXISTING_LEAD_ATTESTATION,
} from '../lib/whatsappSafety'
import { FileText, X } from '../lib/icons.jsx'

const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/mp4,audio/aac,video/mp4'
const MEDIA_ACCEPT_BY_TYPE = {
  image: 'image/jpeg,image/png,image/webp',
  document: 'application/pdf',
  video: 'video/mp4',
}
export { newWhatsappClientRequestId }

export const emptyWhatsAppDraft = () => ({
  clientRequestId: newWhatsappClientRequestId(),
  kind: 'template',
  templateKey: '',
  templateLanguage: '',
  vars: {},
  text: '',
  media: null,
  mediaUploading: false,
  replyToProviderMessageId: '',
  replyPreview: '',
})

export const normalizeWhatsappPreference = (response = {}, leadId = null) => {
  const value = response.preference || response
  return {
    leadId: leadId || value.lead_id || null,
    recipientE164: value.recipient_e164 || null,
    loading: false,
    error: '',
    suppressed: value.suppressed === true,
    consentWhatsapp: value.consent_whatsapp === true,
    reason: value.reason || value.suppression_reason || null,
    source: value.source || value.suppression_source || null,
    suppressedAt: value.suppressed_at || null,
    lastInboundAt: value.last_inbound_at || value.whatsapp_last_inbound_at || null,
    serviceWindowExpiresAt: value.service_window_expires_at || null,
    // This must be asserted by the server. Never infer permission from a browser clock.
    canSendFreeform: value.can_send_freeform === true,
  }
}

const pendingPreference = (leadId = null, recipientE164 = null) => ({
  leadId,
  recipientE164,
  loading: true,
  error: '',
  suppressed: false,
  consentWhatsapp: null,
  reason: null,
  source: null,
  suppressedAt: null,
  lastInboundAt: null,
  serviceWindowExpiresAt: null,
  canSendFreeform: false,
})

export function useWhatsappPreference(leadId, recipientPhone = '', countryCode = DEFAULT_WORKSPACE.countryCode) {
  const recipientE164 = normalizeWhatsAppPhone(recipientPhone, countryCode)
  const [storedPreference, setStoredPreference] = useState(() => pendingPreference(leadId, recipientE164))
  const requestRef = useRef(0)
  const preference = storedPreference.leadId === (leadId || null)
      && storedPreference.recipientE164 === (recipientE164 || null)
    ? storedPreference
    : pendingPreference(leadId, recipientE164 || null)
  const setPreference = useCallback((value) => {
    setStoredPreference((current) => ({
      ...(typeof value === 'function' ? value(current) : value),
      leadId: leadId || null,
      recipientE164: recipientE164 || null,
    }))
  }, [leadId, recipientE164])

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current
    if (!leadId) {
      setStoredPreference(pendingPreference())
      return null
    }
    setStoredPreference(pendingPreference(leadId, recipientE164 || null))
    try {
      const next = normalizeWhatsappPreference(await loadLeadWhatsAppPreference(leadId, countryCode), leadId)
      if (requestRef.current !== requestId) return null
      if ((recipientE164 || null) !== (next.recipientE164 || null)) {
        setStoredPreference({
          ...pendingPreference(leadId, recipientE164 || null),
          loading: false,
          error: 'The WhatsApp number changed. Refresh its status before sending.',
        })
        return null
      }
      setStoredPreference(next)
      return next
    } catch (error) {
      if (requestRef.current !== requestId) return null
      setStoredPreference((current) => ({
        ...current,
        leadId,
        recipientE164: recipientE164 || null,
        loading: false,
        error: error?.message || 'WhatsApp status could not be verified',
      }))
      return null
    }
  }, [leadId, recipientE164, countryCode])

  useEffect(() => {
    reload()
    return () => { requestRef.current += 1 }
  }, [reload])
  // Provider preference callbacks (for example Meta's marketing STOP event) can
  // update the lead without creating a conversation message. Refresh this small,
  // server-authoritative projection while the conversation is open so the send
  // controls fail closed even when there is no message INSERT to observe.
  useEffect(() => {
    if (!leadId) return undefined
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    const timer = window.setInterval(refreshWhenVisible, 60_000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [leadId, reload])
  useEffect(() => {
    if (!preference.canSendFreeform || !preference.serviceWindowExpiresAt) return undefined
    const remaining = new Date(preference.serviceWindowExpiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      setStoredPreference((current) => ({ ...current, canSendFreeform: false }))
      return undefined
    }
    const timer = window.setTimeout(() => {
      setStoredPreference((current) => ({ ...current, canSendFreeform: false }))
    }, Math.min(remaining + 250, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [preference.canSendFreeform, preference.serviceWindowExpiresAt])
  return { preference, setPreference, reload }
}

export { shouldRotateWhatsAppConsentRequest, whatsappConsentIsActive }

export const whatsappSendingBlocked = (preference) => !whatsappConsentIsActive(preference)

const dateTime = (value) => value ? new Date(value).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : ''

const remainingWindow = (expiresAt, now) => {
  const milliseconds = Date.parse(expiresAt || '') - now
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return ''
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`
}

export function WhatsAppPreferenceBanner({
  preference,
  canOptOut,
  stopping,
  onStop,
  canRecordConsent,
  recordingConsent,
  onRecordConsent,
}) {
  const [now, setNow] = useState(Date.now())
  const [consentAttested, setConsentAttested] = useState(false)
  useEffect(() => {
    if (!preference.canSendFreeform || !preference.serviceWindowExpiresAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [preference.canSendFreeform, preference.serviceWindowExpiresAt])
  const canShowConsentAction = canRecordConsent
    && canOfferWhatsAppConsentGrant(preference)
    && Boolean(onRecordConsent)
  useEffect(() => {
    setConsentAttested(false)
  }, [preference.leadId, preference.recipientE164, canShowConsentAction])
  const remaining = remainingWindow(preference.serviceWindowExpiresAt, now)
  const blocked = whatsappSendingBlocked(preference)
  const state = preference.loading ? 'checking'
    : preference.error ? 'error'
      : preference.suppressed ? 'stopped'
        : preference.consentWhatsapp !== true ? 'inactive' : 'active'
  const title = preference.loading ? 'Checking WhatsApp status…'
    : preference.error ? 'WhatsApp status could not be verified'
      : preference.suppressed ? 'WhatsApp updates stopped'
        : preference.consentWhatsapp !== true ? 'WhatsApp consent is not active'
          : preference.canSendFreeform ? '24-hour reply window is open' : 'Template messaging is available'
  let detail = 'Sending is paused while the CRM checks the latest preference.'
  if (preference.error) detail = 'WhatsApp sending is blocked for safety. Refresh before trying again.'
  else if (preference.suppressed) {
    const reason = preference.reason ? String(preference.reason).replaceAll('_', ' ') : 'recipient preference'
    const stoppedContext = `${reason}${preference.source ? ` via ${preference.source}` : ''}${preference.suppressedAt ? ` · stopped ${dateTime(preference.suppressedAt)}` : ''}`
    detail = preference.source === 'staff'
      ? `No automated or manual WhatsApp messages will be sent · ${stoppedContext}. This is a staff safety hold; ask an administrator to review it.`
      : `No automated or manual WhatsApp messages will be sent · ${stoppedContext}. Only the recipient can resume updates by replying START.`
  } else if (preference.consentWhatsapp !== true) {
    detail = canRecordConsent
      ? 'Both template and session messages are blocked. If the lead directly gave permission, record your staff attestation below.'
      : 'Both template and session messages are blocked. Ask a manager to record verified permission.'
  }
  else if (preference.canSendFreeform) {
    detail = `Free-form text and media are available${remaining ? ` for ${remaining}` : ''}${preference.serviceWindowExpiresAt ? ` (until ${dateTime(preference.serviceWindowExpiresAt)})` : ''}. Approved templates also remain available.`
  } else {
    detail = `Use an approved Meta template. Free-form replies are closed${preference.lastInboundAt ? `; the last inbound message was ${dateTime(preference.lastInboundAt)}` : ' until this lead messages your business'}.`
  }

  return (
    <div className={`wa-preference ${state}`}>
      <div className="wa-preference-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {canShowConsentAction && (
        <div className="wa-consent-action">
          <label>
            <input type="checkbox" checked={consentAttested} disabled={recordingConsent}
              onChange={(event) => setConsentAttested(event.target.checked)} />
            <span>{WHATSAPP_EXISTING_LEAD_ATTESTATION}</span>
          </label>
          <small>Records the exact audited confirmation “{WHATSAPP_CONSENT_CONFIRMATION}”. Old cancelled messages stay cancelled.</small>
          <button type="button" className="btn primary sm"
            onClick={() => onRecordConsent(WHATSAPP_CONSENT_CONFIRMATION)}
            disabled={!consentAttested || recordingConsent}>
            {recordingConsent ? 'Recording…' : 'Record WhatsApp consent'}
          </button>
        </div>
      )}
      {canOptOut && canOfferWhatsAppOptOut(preference) && onStop && (
        <button type="button" className="btn danger sm" onClick={onStop} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop WhatsApp updates'}
        </button>
      )}
    </div>
  )
}

export const selectedWhatsappTemplate = (templates, draft) =>
  (templates || []).find((template) => template.key === draft.templateKey
    && (!draft.templateLanguage || template.language === draft.templateLanguage)) || null

export const canSubmitWhatsappDraft = (draft, templates, preference) => {
  if (whatsappSendingBlocked(preference)) return false
  if (draft.mediaUploading) return false
  if (draft.kind === 'session') {
    return preference.canSendFreeform === true && Boolean(draft.text.trim() || draft.media?.ref)
  }
  const template = selectedWhatsappTemplate(templates, draft)
  const requiredMediaType = whatsappTemplateMediaType(template)
  return Boolean(template
    && whatsappTemplateMissingVars(template, draft.vars).length === 0
    && (!requiredMediaType || (draft.media?.ref && draft.media.type === requiredMediaType)))
}

export const whatsappDraftPayload = (draft, templates, leadName) => {
  if (draft.kind === 'session') {
    return {
      kind: 'session',
      text: draft.text.trim() || undefined,
      body: draft.text.trim(),
      media_ref: draft.media?.ref || undefined,
      media_type: draft.media?.type || undefined,
      media_mime_type: draft.media?.mimeType || undefined,
      media_file_name: draft.media?.fileName || undefined,
      caption: draft.media && draft.text.trim() ? draft.text.trim() : undefined,
      reply_to_provider_message_id: draft.replyToProviderMessageId || undefined,
      client_request_id: draft.clientRequestId,
    }
  }
  const template = selectedWhatsappTemplate(templates, draft)
  return {
    kind: 'template',
    template_key: template?.key,
    language: template?.language || 'en_US',
    vars: whatsappTemplatePayloadVars(template, leadName, draft.vars),
    body: fillTemplate(template, leadName, draft.vars),
    media_ref: draft.media?.ref || undefined,
    media_type: draft.media?.type || undefined,
    media_mime_type: draft.media?.mimeType || undefined,
    media_file_name: draft.media?.fileName || undefined,
    reply_to_provider_message_id: draft.replyToProviderMessageId || undefined,
    client_request_id: draft.clientRequestId,
  }
}

export function WhatsAppComposer({
  draft,
  onChange,
  templates,
  templatesLoading,
  templatesError,
  preference,
  leadName,
  disabled,
}) {
  const fileRef = useRef(null)
  const uploadRequestRef = useRef(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const template = selectedWhatsappTemplate(templates, draft)
  const templateMediaType = whatsappTemplateMediaType(template)
  const inputVars = whatsappTemplateInputVars(template)
  const preview = template ? fillTemplate(template, leadName, draft.vars) : ''
  const blocked = whatsappSendingBlocked(preference)
  // Editing creates a new logical request. A retry without edits keeps the same
  // idempotency key, protecting against an ambiguous response after dispatch.
  const patch = (fields) => onChange((current) => ({
    ...current,
    ...fields,
    clientRequestId: newWhatsappClientRequestId(),
  }))

  useEffect(() => () => { uploadRequestRef.current += 1 }, [])

  useEffect(() => {
    if (draft.kind === 'session' && !preference.loading && !preference.error && !preference.canSendFreeform) {
      onChange({ ...emptyWhatsAppDraft(), kind: 'template' })
    }
  }, [draft.kind, preference.loading, preference.error, preference.canSendFreeform])

  const setKind = (kind) => patch({
    kind,
    templateKey: kind === 'template' ? draft.templateKey : '',
    templateLanguage: kind === 'template' ? draft.templateLanguage : '',
    vars: kind === 'template' ? draft.vars : {},
    text: kind === 'session' ? draft.text : '',
    media: null,
    mediaUploading: false,
  })

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const requestId = ++uploadRequestRef.current
    setUploading(true)
    setUploadError('')
    patch({ media: null, mediaUploading: true })
    try {
      const media = await uploadWhatsappMedia(file)
      if (uploadRequestRef.current !== requestId) return
      if (templateMediaType && media.type !== templateMediaType) {
        throw new Error(`This template requires a ${templateMediaType} attachment`)
      }
      patch({ media, mediaUploading: false })
    } catch (error) {
      if (uploadRequestRef.current !== requestId) return
      setUploadError(error.message || 'Upload failed')
      patch({ mediaUploading: false })
    } finally {
      if (uploadRequestRef.current === requestId) setUploading(false)
    }
  }

  const mediaPicker = (requiredType = '') => (
    <>
      <input ref={fileRef} type="file" accept={MEDIA_ACCEPT_BY_TYPE[requiredType] || MEDIA_ACCEPT} onChange={upload} hidden />
      <div className="wa-media-row">
        {draft.media ? (
          <span className="wa-media-chip"><FileText />{draft.media.fileName}
            <button type="button" aria-label="Remove attachment" onClick={() => patch({ media: null })}><X /></button>
          </span>
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={disabled || uploading}>
            <FileText /> {uploading ? 'Uploading…' : requiredType ? `Attach ${requiredType}` : 'Attach private media'}
          </button>
        )}
        <span className="faint">{requiredType
          ? `A ${requiredType} header is required by this approved template.`
          : 'Images, PDF, audio or MP4 · 5–25 MB by type'}</span>
      </div>
      {uploadError && <p className="wa-composer-error">{uploadError}</p>}
    </>
  )

  if (blocked) {
    return <p className="wa-composer-note">WhatsApp is blocked until consent and suppression status are verified.</p>
  }

  return (
    <div className="wa-composer">
      <div className="wa-composer-controls">
        <select value={draft.kind} onChange={(event) => setKind(event.target.value)} aria-label="WhatsApp message kind" disabled={disabled || uploading}>
          <option value="template">Approved template</option>
          <option value="session" disabled={!preference.canSendFreeform}>24-hour reply</option>
        </select>
        {draft.kind === 'template' && (
          <select value={draft.templateKey ? `${draft.templateKey}::${draft.templateLanguage}` : ''} onChange={(event) => {
            const separator = event.target.value.lastIndexOf('::')
            patch({
              templateKey: separator < 0 ? event.target.value : event.target.value.slice(0, separator),
              templateLanguage: separator < 0 ? '' : event.target.value.slice(separator + 2),
              vars: {},
              media: null,
              mediaUploading: false,
            })
          }}
            aria-label="WhatsApp template" disabled={disabled || uploading || templatesLoading || Boolean(templatesError)}>
            <option value="">{templatesLoading ? 'Loading Meta templates…' : 'Choose a template…'}</option>
            {(templates || []).map((item) => (
              <option key={`${item.key}:${item.language}`} value={`${item.key}::${item.language}`}>{item.label} · {item.language}</option>
            ))}
          </select>
        )}
      </div>

      {templatesError && draft.kind === 'template' && <p className="wa-composer-error">{templatesError}</p>}
      {!templatesLoading && !templatesError && draft.kind === 'template' && templates.length === 0 && (
        <p className="wa-composer-note">No approved Meta templates are ready. Ask a manager to sync templates after approval in WhatsApp Manager.</p>
      )}

      {draft.replyToProviderMessageId && (
        <div className="wa-reply-context">
          <span><strong>Replying to</strong> {draft.replyPreview || 'WhatsApp message'}</span>
          <button type="button" className="icon-btn" aria-label="Remove reply context"
            onClick={() => patch({ replyToProviderMessageId: '', replyPreview: '' })}><X /></button>
        </div>
      )}

      {draft.kind === 'template' ? (
        template && (
          <>
            {inputVars.length > 0 && (
              <div className="wa-template-fields">
                {inputVars.map((variable) => (
                  <input key={variable.key} className="input"
                    value={draft.vars[variable.key] || ''}
                    placeholder={`${variable.label}${variable.placeholder ? ` — e.g. ${variable.placeholder}` : ''}`}
                    onChange={(event) => patch({ vars: { ...draft.vars, [variable.key]: event.target.value } })}
                    aria-label={variable.label} disabled={disabled} />
                ))}
              </div>
            )}
            {templateMediaType && mediaPicker(templateMediaType)}
            <div className="msg out wa-template-preview">{preview}</div>
          </>
        )
      ) : (
        <>
          <textarea className="input" value={draft.text} onChange={(event) => patch({ text: event.target.value })}
            placeholder="Write a reply within the open 24-hour window…" rows={3} disabled={disabled}
            aria-label="WhatsApp reply" />
          {mediaPicker()}
        </>
      )}
    </div>
  )
}

function PrivateAttachment({ message }) {
  const ref = messageMediaRef(message)
  const [state, setState] = useState({ loading: Boolean(ref), url: '', error: '' })
  const media = message.media || {}
  const hintedMime = media.mime_type || media.mimeType || message.media_mime_type || ''
  const fileName = media.file_name || media.fileName || message.media_file_name || 'WhatsApp attachment'

  useEffect(() => {
    if (!ref) return undefined
    let active = true
    let objectUrl = ''
    downloadWhatsappMedia(ref).then((blob) => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setState({ loading: false, url: objectUrl, error: '', mime: blob.type || hintedMime })
    }).catch((error) => {
      if (active) setState({ loading: false, url: '', error: error.message || 'Attachment unavailable' })
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ref, hintedMime])

  if (!ref) return <div className="wa-attachment unavailable">Attachment unavailable</div>
  if (state.loading) return <div className="wa-attachment loading">Loading private attachment…</div>
  if (state.error) return <div className="wa-attachment unavailable">{state.error}</div>
  const mime = state.mime || hintedMime
  if (mime.startsWith('image/')) return (
    <a className="wa-attachment-preview" href={state.url} target="_blank" rel="noreferrer" title="Open full-size attachment">
      <img className="wa-attachment-image" src={state.url} alt={fileName} />
    </a>
  )
  if (mime.startsWith('video/')) return <video className="wa-attachment-video" src={state.url} controls preload="metadata" />
  if (mime.startsWith('audio/')) return <audio className="wa-attachment-audio" src={state.url} controls preload="metadata" />
  return <a className="wa-attachment document" href={state.url} download={fileName}><FileText /> {fileName}</a>
}

const hasMedia = (message) => Boolean(message?.media || message?.media_ref
  || ['image', 'document', 'audio', 'video', 'media'].includes(message?.message_type))

const whatsappMessageAnchor = (providerId) => providerId
  ? `wa-message-${String(providerId).replace(/[^A-Za-z0-9_-]/g, '_')}`
  : undefined

const focusWhatsappMessage = (providerId) => {
  const element = document.getElementById(whatsappMessageAnchor(providerId))
  if (!element) return
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.classList.add('wa-message-highlight')
  window.setTimeout(() => element.classList.remove('wa-message-highlight'), 1800)
}

const preferenceReply = (message) => {
  if (message?.direction !== 'in' || message?.channel !== 'whatsapp') return null
  const recordedAction = String(message?.interaction?.preference_action || '').toLowerCase()
  const applied = message?.interaction?.preference_applied
  if (recordedAction === 'stop') return { action: 'stop', applied: applied === true }
  if (recordedAction === 'start') return { action: 'start', applied: applied === true }
  const value = String(message?.interaction?.action_id || message?.body || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (/^(?:please )?(?:stop|stop updates?|unsubscribe|opt out)(?: (?:all )?(?:updates?|messages?|whatsapp updates?))?(?: please)?$/.test(value)) {
    // Older rows may not carry the application result. Show receipt without
    // claiming that the preference change was committed.
    return { action: 'stop', applied: false }
  }
  if (/^(?:please )?(?:start|resume|subscribe|opt in)(?: (?:all )?(?:updates?|messages?|whatsapp updates?))?(?: please)?$/.test(value)) {
    return { action: 'start', applied: false }
  }
  return null
}

const triggerLabel = (trigger) => {
  if (!trigger || typeof trigger !== 'object') return ''
  if (trigger.matched === false) return 'No automation matched'
  const status = String(trigger.status || '').toLowerCase()
  if (status === 'completed' || status === 'succeeded') return 'Trigger completed'
  if (status === 'processed') return 'Trigger processed'
  if (status === 'failed') return 'Trigger failed'
  if (status === 'queued' || status === 'pending' || status === 'processing') return 'Trigger queued'
  return trigger.matched === true ? 'Trigger matched' : ''
}

export function WhatsAppMessageBubble({ message, time, maxWidth, onReply }) {
  const failure = messageSafeFailure(message)
  const providerId = messageProviderId(message)
  const contextProviderId = message.context?.provider_message_id || message.context_provider_message_id || ''
  const contextPreview = message.context?.body_preview || message.context?.preview || message.context?.text || ''
  const interaction = message.interaction || {}
  const interactive = message.direction === 'in' && ['button', 'list', 'interactive'].includes(message.message_type)
  const interactionTitle = interaction.action_title || message.body || interaction.action_id || 'Reply selected'
  const preferenceReplyState = preferenceReply(message)
  const automationState = triggerLabel(interaction.quick_reply_trigger)
  return (
    <div id={whatsappMessageAnchor(providerId)} className={'msg ' + (message.direction === 'out' ? 'out' : 'in')} style={maxWidth ? { maxWidth } : undefined}>
      {message.context && (contextProviderId
        ? <button type="button" className="wa-message-context" onClick={() => focusWhatsappMessage(contextProviderId)}>{contextPreview || 'Reply to an earlier WhatsApp message'}</button>
        : <div className="wa-message-context">{contextPreview || 'Reply to an earlier WhatsApp message'}</div>)}
      {hasMedia(message) && <PrivateAttachment message={message} />}
      {interactive && (
        <div className="wa-interaction-label">
          <span>{message.message_type === 'list' ? 'List choice' : 'Quick reply'}</span>
          <strong>{interactionTitle}</strong>
        </div>
      )}
      {message.body && (!interactive || interactionTitle !== message.body) && <div className="wa-message-body">{message.body}</div>}
      {preferenceReplyState?.action === 'stop' && (
        <div className="wa-stop-event">{preferenceReplyState.applied
          ? 'STOP received — WhatsApp updates and pending sends were stopped.'
          : 'STOP received — no new preference change was applied.'}</div>
      )}
      {preferenceReplyState?.action === 'start' && (
        <div className="wa-stop-event">{preferenceReplyState.applied
          ? 'START received — WhatsApp updates were resumed for this number.'
          : 'START received — no new preference change was applied.'}</div>
      )}
      {automationState && !preferenceReplyState && (
        <div className={`wa-trigger-result ${String(interaction.quick_reply_trigger?.status || '').toLowerCase()}`}>
          {automationState}{interaction.source_template_key ? ` · ${interaction.source_template_key}` : ''}
        </div>
      )}
      {failure && <div className={`wa-message-error${message.status === 'cancelled' ? ' cancelled' : ''}`}>{failure}</div>}
      <div className="meta">
        <span>{channelLabel(message.channel)}</span>
        <span className={'pill ' + messageStatusPill(message.status)}>
          <span className="dot" />{messageStatusLabel(message.status)}
        </span>
        <span>{time}</span>
        {onReply && providerId && message.channel === 'whatsapp' && message.direction === 'in' && (
          <button type="button" className="wa-reply-button" onClick={() => onReply(message)}>Reply</button>
        )}
      </div>
    </div>
  )
}
