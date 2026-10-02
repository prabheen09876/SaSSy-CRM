import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { DEFAULT_WORKSPACE, workspaceTerminology } from '../lib/workspace'
import IntegrationNotice from './IntegrationNotice.jsx'
import {
  initials, loadMessages, loadTemplates, loadWhatsappTemplates, mergeMessageChange,
  recordLeadWhatsAppConsent, sendMessage, stopLeadWhatsAppUpdates, subscribeMessages,
} from '../lib/db'
import { CHANNELS, channelLabel, channelPill } from '../lib/constants'
import { Chat, Send, Search, Back } from '../lib/icons.jsx'
import {
  canSubmitWhatsappDraft,
  emptyWhatsAppDraft,
  newWhatsappClientRequestId,
  normalizeWhatsappPreference,
  shouldRotateWhatsAppConsentRequest,
  useWhatsappPreference,
  WhatsAppComposer,
  WhatsAppMessageBubble,
  WhatsAppPreferenceBanner,
  whatsappConsentIsActive,
  whatsappDraftPayload,
} from './WhatsAppShared.jsx'
import { whatsappSendNotice } from '../lib/whatsappSafety'

const MOBILE = 860

const msgTime = (at) =>
  new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || ''
const messagePreview = (message) => {
  if (!message) return ''
  if (message.direction === 'in' && ['button', 'list', 'interactive'].includes(message.message_type)) {
    const title = message.interaction?.action_title || message.body || message.interaction?.action_id || 'Reply selected'
    return `${message.message_type === 'list' ? 'List choice' : 'Quick reply'}: ${title}`
  }
  return message.body || (message.media || message.media_ref ? 'Attachment' : '')
}

export default function Messages({ leads, onOpen }) {
  const { notify, can, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const countryCode = workspace?.countryCode || DEFAULT_WORKSPACE.countryCode
  const [msgs, setMsgs] = useState([])
  const [tpls, setTpls] = useState([])
  const [waTemplates, setWaTemplates] = useState([])
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(true)
  const [waTemplatesError, setWaTemplatesError] = useState('')
  const [selected, setSelected] = useState(null)
  const threadEndRef = useRef(null)
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)

  // composer state
  const [channel, setChannel] = useState('whatsapp')
  const [tplId, setTplId] = useState('')       // email template picker
  const [body, setBody] = useState('')         // email free text
  const [waDraft, setWaDraft] = useState(emptyWhatsAppDraft)
  const [sending, setSending] = useState(false)
  const [waStopping, setWaStopping] = useState(false)
  const [waConsentRecording, setWaConsentRecording] = useState(false)
  const waConsentRequestRef = useRef({ leadId: null, requestId: '' })
  const waConsentRecordingRef = useRef(false)
  const {
    preference: waPreference,
    setPreference: setWaPreference,
    reload: reloadWaPreference,
  } = useWhatsappPreference(selected, (leads || []).find((item) => item.id === selected)?.phone, countryCode)

  useEffect(() => {
    let alive = true
    Promise.all([loadMessages(), loadTemplates()]).then(([m, t]) => {
      if (!alive) return
      setMsgs(m || [])
      setTpls(t || [])
    }).catch((error) => { if (alive) notify(error.message || 'Could not load messages', true) })
    loadWhatsappTemplates().then((templates) => {
      if (!alive) return
      setWaTemplates(templates)
      setWaTemplatesError('')
    }).catch(() => {
      if (!alive) return
      setWaTemplates([])
      setWaTemplatesError('Approved Meta templates could not be loaded. Sending is paused.')
    }).finally(() => { if (alive) setWaTemplatesLoading(false) })
    return () => { alive = false }
  }, [notify])

  useEffect(() => subscribeMessages((change) => {
    setMsgs((current) => mergeMessageChange(current, change, 'desc'))
    if (change.message?.lead_id === selected && change.message?.channel === 'whatsapp'
      && change.message?.direction === 'in') reloadWaPreference()
  }), [selected, reloadWaPreference])

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Clear the composer whenever we switch conversations, so a half-filled template
  // (or free-typed email) for one lead can never be sent to another.
  useEffect(() => {
    setWaDraft(emptyWhatsAppDraft()); setBody(''); setTplId('')
    setWaConsentRecording(false)
    waConsentRecordingRef.current = false
    waConsentRequestRef.current = {
      leadId: selected,
      requestId: selected ? newWhatsappClientRequestId() : '',
    }
  }, [selected])

  const isMobile = width < MOBILE

  const leadsById = useMemo(() => {
    const map = {}
    for (const l of leads || []) map[l.id] = l
    return map
  }, [leads])

  // group messages into conversations, sorted newest-first by lastAt
  const conversations = useMemo(() => {
    const groups = {}
    for (const m of msgs) {
      if (!groups[m.lead_id]) groups[m.lead_id] = []
      groups[m.lead_id].push(m)
    }
    const list = Object.keys(groups).map((lead_id) => {
      const thread = groups[lead_id].slice().sort((a, b) => new Date(a.at) - new Date(b.at))
      return {
        lead_id,
        lead: leadsById[lead_id] || null,
        messages: thread,
        lastAt: thread.length ? thread[thread.length - 1].at : null,
      }
    })
    list.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
    return list
  }, [msgs, leadsById])

  const conv = useMemo(
    () => conversations.find((c) => c.lead_id === selected) || null,
    [conversations, selected],
  )

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, conv?.messages.length])

  const canSend = channel === 'email'
    ? !!body.trim()
    : canSubmitWhatsappDraft(waDraft, waTemplates, waPreference)

  const handleSend = async () => {
    if (!selected || !canSend || sending) return
    setSending(true)
    try {
      const payload = channel === 'email'
        ? { lead_id: selected, channel: 'email', body: body.trim() }
        : { lead_id: selected, channel: 'whatsapp', ...whatsappDraftPayload(waDraft, waTemplates, conv?.lead?.name) }
      const m = await sendMessage(payload)
      setMsgs((prev) => prev.some((message) => m.id && message.id === m.id)
        ? prev
        : mergeMessageChange(prev, {
          eventType: 'INSERT', message: { ...m, direction: m.direction || 'out' },
        }, 'desc'))
      setBody(''); setTplId(''); setWaDraft(emptyWhatsAppDraft())
      if (channel === 'whatsapp') {
        const notice = whatsappSendNotice(m)
        notify(notice.message, notice.error)
      } else notify('Email sent')
    } catch (e) {
      notify(e.message || 'Could not send the message', true)
    } finally {
      setSending(false)
    }
  }

  const stopWhatsApp = async () => {
    if (!selected || waStopping || waPreference.suppressed) return
    if (!confirm(`Stop WhatsApp updates for ${conv?.lead?.name || `this ${terms.record}`}?\n\nThis revokes consent, cancels queued messages, and stops nurture sends.`)) return
    setWaStopping(true)
    try {
      const result = await stopLeadWhatsAppUpdates(selected, waPreference.recipientE164, countryCode)
      setWaPreference(normalizeWhatsappPreference({
        ...result,
        consent_whatsapp: false,
        suppressed: true,
        reason: result.reason || 'recipient_request',
        source: result.source || 'recipient',
        can_send_freeform: false,
      }))
      setWaDraft(emptyWhatsAppDraft())
      notify('WhatsApp updates stopped')
    } catch (error) {
      await reloadWaPreference()
      notify(error.code === 'recipient_changed'
        ? 'The WhatsApp number changed. Review the current number before stopping updates.'
        : (error.message || 'Could not stop WhatsApp updates'), true)
    } finally {
      setWaStopping(false)
    }
  }

  const recordWhatsAppConsent = async (confirmation) => {
    if (!selected || !can('messages.recordConsent') || waConsentRecordingRef.current
      || waPreference.loading || waPreference.error || waPreference.suppressed
      || waPreference.consentWhatsapp !== false) return false
    if (waConsentRequestRef.current.leadId !== selected || !waConsentRequestRef.current.requestId) {
      waConsentRequestRef.current = { leadId: selected, requestId: newWhatsappClientRequestId() }
    }
    const requestId = waConsentRequestRef.current.requestId
    waConsentRecordingRef.current = true
    setWaConsentRecording(true)
    try {
      const result = await recordLeadWhatsAppConsent(
        selected, requestId, confirmation, waPreference.recipientE164, countryCode,
      )
      const nextPreference = result?.preference
        ? normalizeWhatsappPreference(result.preference, selected)
        : await reloadWaPreference()
      if (!whatsappConsentIsActive(nextPreference)) {
        const error = new Error('WhatsApp consent is still not active. Sending remains blocked.')
        error.code = nextPreference?.suppressed
          ? (nextPreference.source === 'staff' ? 'staff_suppressed' : 'recipient_start_required')
          : 'consent_not_active'
        throw error
      }
      if (result?.preference) setWaPreference(nextPreference)
      waConsentRequestRef.current = { leadId: selected, requestId: newWhatsappClientRequestId() }
      setWaDraft(emptyWhatsAppDraft())
      notify('WhatsApp consent recorded. Old cancelled messages remain cancelled; send a fresh approved template when ready.')
      return true
    } catch (error) {
      if (shouldRotateWhatsAppConsentRequest(error.code)) {
        waConsentRequestRef.current = { leadId: selected, requestId: newWhatsappClientRequestId() }
      }
      await reloadWaPreference()
      if (error.code === 'recipient_start_required') {
        notify('WhatsApp remains stopped. Only the recipient can resume updates by replying START.', true)
      } else if (error.code === 'staff_suppressed') {
        notify('WhatsApp remains blocked by a staff safety hold. Review the suppression before recording consent.', true)
      } else if (error.code === 'recipient_changed') {
        notify('The WhatsApp number changed. Review the current number and confirm consent again.', true)
      } else if (error.code === 'consent_not_active') {
        notify('WhatsApp consent could not be activated. Sending remains blocked; please try the attestation again.', true)
      } else {
        notify(error.message || 'Could not record WhatsApp consent', true)
      }
      return false
    } finally {
      waConsentRecordingRef.current = false
      setWaConsentRecording(false)
    }
  }

  const replyTo = (message) => {
    if (!waPreference.canSendFreeform) {
      notify('The 24-hour reply window is closed. Use an approved template.', true)
      return
    }
    setChannel('whatsapp')
    setWaDraft({
      ...emptyWhatsAppDraft(),
      kind: 'session',
      replyToProviderMessageId: message.provider_message_id || message.wamid || '',
      replyPreview: message.body || 'Attachment',
    })
  }

  const onPickEmailTemplate = (id) => {
    setTplId(id)
    if (!id) return
    const t = tpls.find((x) => String(x.id) === String(id))
    if (!t) return
    const fn = firstName(conv?.lead?.name)
    setBody((t.body || '').replaceAll('{{name}}', fn))
  }

  const composer = can('messages.send') && conv ? (
    <div className="stack" style={{ flexShrink: 0, gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="select" value={channel} onChange={(e) => {
          setChannel(e.target.value)
          if (e.target.value !== 'whatsapp') setWaDraft(emptyWhatsAppDraft())
        }}
          aria-label="Message channel">
          {CHANNELS.filter((c) => c.v !== 'ai' && c.v !== 'sms').map((c) => (
            <option key={c.v} value={c.v}>{c.l}</option>
          ))}
        </select>
        {channel === 'email' && (
          <select className="select" value={tplId} onChange={(e) => onPickEmailTemplate(e.target.value)}
            aria-label="Use a template" style={{ flex: 1, minWidth: 160 }}>
            <option value="">Use a template…</option>
            {tpls.filter((t) => t.channel === 'email').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {channel === 'whatsapp' ? (
        <>
          <WhatsAppPreferenceBanner preference={waPreference} canOptOut={can('messages.optOut')}
            stopping={waStopping} onStop={stopWhatsApp}
            canRecordConsent={can('messages.recordConsent')} recordingConsent={waConsentRecording}
            onRecordConsent={recordWhatsAppConsent} />
          <WhatsAppComposer key={selected} draft={waDraft} onChange={setWaDraft} templates={waTemplates}
            templatesLoading={waTemplatesLoading} templatesError={waTemplatesError}
            preference={waPreference} leadName={conv.lead?.name} disabled={sending} />
        </>
      ) : (
        <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…" rows={3} style={{ minHeight: 84, resize: 'vertical', lineHeight: 1.55 }}
          aria-label="Message body" />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={handleSend} disabled={!canSend || sending}>
          <Send /> {sending ? 'Queuing…' : 'Send'}
        </button>
      </div>
    </div>
  ) : null

  // ── conversation list (shared between layouts) ───────────────────────────
  const [query, setQuery] = useState('')
  const visibleConvos = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => (c.lead?.name || '').toLowerCase().includes(q))
  }, [conversations, query])

  const convList = (
    <div className="panel" style={{ padding: 12, minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>
      <div className="search" style={{ marginBottom: 10 }}>
        <Search />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…" aria-label="Search conversations" />
      </div>
      <div className="stack" style={{ gap: 4, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {visibleConvos.map((c) => {
          const last = c.messages[c.messages.length - 1]
          const active = c.lead_id === selected
          const name = c.lead?.name || `Unknown ${terms.record}`
          return (
            <button key={c.lead_id} onClick={() => setSelected(c.lead_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '10px 10px', border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer',
              }}>
              <span className="avatar sm" style={{ flexShrink: 0 }}>{initials(name)}</span>
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between', minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {name}
                  </strong>
                  <span className="faint" style={{ fontSize: 11, flexShrink: 0 }}>{last ? msgTime(last.at) : ''}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span className="faint" style={{
                    fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                  }}>
                    {messagePreview(last)}
                  </span>
                  {last && (
                    <span className={'pill ' + channelPill(last.channel)} style={{ flexShrink: 0 }}>
                      <span className="dot" />{channelLabel(last.channel)}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  // ── thread (shared) ──────────────────────────────────────────────────────
  const thread = conv ? (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, flex: 1 }}>
      <div className="row-between" style={{ marginBottom: 12, flexShrink: 0 }}>
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
          {conv.lead?.name || `Unknown ${terms.record}`}
        </strong>
        {conv.lead && (
          <button className="btn ghost sm" onClick={() => onOpen(conv.lead_id)}>Open {terms.record}</button>
        )}
      </div>
      <div className="stack" style={{ flex: 1, minHeight: 0, overflow: 'auto', gap: 8, paddingRight: 2 }}>
        {conv.messages.map((m) => (
          <WhatsAppMessageBubble key={m.id} message={m} time={msgTime(m.at)} onReply={replyTo} />
        ))}
        <div ref={threadEndRef} aria-hidden="true" />
      </div>
      {composer}
    </div>
  ) : null

  return (
    <>
      <IntegrationNotice />
      <div className="page-head">
        <div>
          <span className="ttl">Messages</span>
          <p className="sub">Every WhatsApp and email with your {terms.records}, in one thread.</p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <Chat width="26" height="26" />
            <p>No messages yet.</p>
            <p className="faint" style={{ fontSize: 12.5, marginTop: 4, maxWidth: 420, lineHeight: 1.5 }}>
              Open the {terms.record} profile and use the message box to start a WhatsApp or email thread —
              conversations show up here, and replies land back automatically.
            </p>
          </div>
        </div>
      ) : isMobile ? (
        !conv ? (
          convList
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 188px)', minHeight: 340 }}>
            <button className="back" style={{ flexShrink: 0 }} onClick={() => setSelected(null)}>
              <Back /> Back to conversations
            </button>
            {thread}
          </div>
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14, alignItems: 'stretch', height: 'calc(100dvh - 200px)', minHeight: 360 }}>
          {convList}
          {conv ? thread : (
            <div className="panel" style={{ minWidth: 0, display: 'grid', placeItems: 'center' }}>
              <div className="empty">
                <Chat width="26" height="26" />
                <p>Select a conversation to read the thread.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
