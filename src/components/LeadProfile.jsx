import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { QUAL, PRIORITIES, SOURCE_CHANNELS, ACTIVITY_TYPES, CHANNELS, APPT_TYPES, APPT_STATUSES, qualPill, journeyPill, apptTypeLabel, apptStatusLabel, apptStatusPill, leadTypeLabel, displayLeadTypeLabel, displayLeadTypePill, LEAD_TYPES_FALLBACK } from '../lib/constants'
import { DEFAULT_WORKSPACE, workspaceStageLabel, workspaceStageOptions, workspaceTerminology } from '../lib/workspace'
import {
  initials, clampScore, fmtDate, loadActivities, addActivity, deleteActivity, loadLeadMessages,
  sendMessage, loadTemplates, loadWhatsappTemplates, loadLead, loadAppointments, createAppointment,
  updateAppointment, mergeMessageChange, recordLeadWhatsAppConsent,
  stopLeadWhatsAppUpdates, subscribeMessages,
} from '../lib/db'
import { Back, Check, Plus, Trash, Send } from '../lib/icons.jsx'
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
import { normalizeRecordPhone, whatsappSendNotice } from '../lib/whatsappSafety'
import CallLeadButton from './CallLeadButton.jsx'

// ISO timestamp → 'YYYY-MM-DDTHH:MM' in LOCAL time, for a datetime-local input
const toLocalDT = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function LeadProfile({ lead, onBack, backLabel }) {
  const { patchLead, profiles, notify, can, leadTypes, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const countryCode = workspace?.countryCode || DEFAULT_WORKSPACE.countryCode
  const stageOptions = workspaceStageOptions(workspace, [lead?.journeyStatus])
  const customFieldDefinitions = workspace?.customFields || []
  const staffName = (id) => profiles.find((p) => p.id === id)?.name || ''
  const leadTypeOpts = leadTypes?.length ? leadTypes : LEAD_TYPES_FALLBACK
  const [acts, setActs] = useState([])
  const [msgs, setMsgs] = useState([])
  const [tpls, setTpls] = useState([])
  const [waTemplates, setWaTemplates] = useState([])
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(true)
  const [waTemplatesError, setWaTemplatesError] = useState('')
  const [mChannel, setMChannel] = useState('whatsapp')
  const [mBody, setMBody] = useState('')       // email free text
  const [mTpl, setMTpl] = useState('')         // email template picker
  const [waDraft, setWaDraft] = useState(emptyWhatsAppDraft)
  const [mBusy, setMBusy] = useState(false)
  // Keep WhatsApp safety keyed to the number currently shown in the editor.
  // Typing a different number immediately invalidates the old number's consent
  // projection, before the save request has even reached the server.
  const [basic, setBasic] = useState({})
  const [business, setBusiness] = useState({})
  const [customValues, setCustomValues] = useState({})
  const [remarks, setRemarks] = useState('')
  const {
    preference: waPreference,
    setPreference: setWaPreference,
    reload: reloadWaPreference,
  } = useWhatsappPreference(lead?.id, basic.phone ?? lead?.phone, countryCode)
  const [waStopping, setWaStopping] = useState(false)
  const [waConsentRecording, setWaConsentRecording] = useState(false)
  const waConsentRequestRef = useRef({ leadId: null, requestId: '' })
  const waConsentRecordingRef = useRef(false)
  const [adding, setAdding] = useState(false)
  const [appts, setAppts] = useState([])
  const [booking, setBooking] = useState(false)
  const setJourney = async (value) => {
    if (await patchLead(lead.id, { journeyStatus: value })) {
      notify(`Stage saved: ${workspaceStageLabel(workspace, value)}`)
    }
  }

  useEffect(() => {
    if (!lead) return
    let current = true
    // clear the composer so a half-filled message never carries to another lead
    setMChannel('whatsapp'); setMBody(''); setMTpl(''); setWaDraft(emptyWhatsAppDraft())
    setBasic({
      name: lead.name || '', phone: lead.phone || '', email: lead.email || '',
      source: lead.source || '', sourceChannel: lead.sourceChannel || '',
      company: lead.company || '', jobTitle: lead.jobTitle || '', city: lead.city || '', website: lead.website || '',
    })
    setBusiness({ interest: lead.interest || '', budget: lead.budget ?? '', expectedCloseDate: lead.expectedCloseDate || '', currency: lead.currency || workspace?.currency || 'USD' })
    setCustomValues({ ...(lead.customFields || {}) })
    setRemarks(lead.remarks || '')
    setActs([]); setMsgs([]); setAppts([]); setBooking(false); setAdding(false)
    loadActivities(lead.id).then((items) => { if (current) setActs(items) }).catch((e) => { if (current) notify('Could not load activity: ' + e.message, true) })
    loadLeadMessages(lead.id).then((items) => { if (current) setMsgs(items) }).catch(() => {})
    loadTemplates().then((items) => { if (current) setTpls(items) }).catch(() => {})
    setWaTemplatesLoading(true)
    loadWhatsappTemplates().then((templates) => {
      if (!current) return
      setWaTemplates(templates)
      setWaTemplatesError('')
    }).catch(() => {
      if (!current) return
      setWaTemplates([])
      setWaTemplatesError('Approved Meta templates could not be loaded. Sending is paused.')
    }).finally(() => { if (current) setWaTemplatesLoading(false) })
    loadAppointments(lead.id).then((items) => { if (current) setAppts(items) }).catch(() => {})
    // Load complete notes and workspace fields when opening a record.
    loadLead(lead.id).then((full) => {
      if (!current || !full) return
      setBasic({
        name: full.name || '', phone: full.phone || '', email: full.email || '',
        source: full.source || '', sourceChannel: full.sourceChannel || '',
        company: full.company || '', jobTitle: full.jobTitle || '', city: full.city || '', website: full.website || '',
      })
      setBusiness({ interest: full.interest || '', budget: full.budget ?? '', expectedCloseDate: full.expectedCloseDate || '', currency: full.currency || workspace?.currency || 'USD' })
      setCustomValues({ ...(full.customFields || {}) })
      setRemarks(full.remarks || '')
    }).catch((error) => { if (current) notify(`Could not load complete ${terms.record} details: ` + error.message, true) })
    return () => { current = false }
  }, [lead?.id])

  useEffect(() => {
    setWaStopping(false)
    setWaConsentRecording(false)
    waConsentRecordingRef.current = false
    waConsentRequestRef.current = {
      leadId: lead?.id || null,
      requestId: lead?.id ? newWhatsappClientRequestId() : '',
    }
  }, [lead?.id])

  useEffect(() => {
    if (!lead?.id) return undefined
    return subscribeMessages((change) => {
      setMsgs((current) => mergeMessageChange(current, change, 'asc'))
      if (change.message?.channel === 'whatsapp' && change.message?.direction === 'in') reloadWaPreference()
    }, lead.id)
  }, [lead?.id, reloadWaPreference])

  if (!lead) return <><button className="back" onClick={onBack}><Back /> Back</button><p>{terms.recordSingular} not found.</p></>

  const saveBasic = async () => {
    if (!basic.name.trim()) return notify('Name cannot be empty', true)
    const fields = normalizeRecordPhone(basic, countryCode)
    const phoneChanged = fields.phone !== normalizeRecordPhone({ phone: lead.phone }, countryCode).phone
    // A previous recipient's permission does not transfer to a new phone number.
    if (phoneChanged) fields.consentWhatsapp = false
    const saved = await patchLead(lead.id, fields)
    if (!saved) return
    setBasic((current) => current.phone === basic.phone ? { ...current, phone: fields.phone } : current)
    if (phoneChanged) setWaDraft(emptyWhatsAppDraft())
    await reloadWaPreference()
    notify('Basic info saved')
  }
  const saveBusiness = async (event) => {
    event.preventDefault()
    if (business.budget !== '' && (!Number.isFinite(Number(business.budget)) || Number(business.budget) < 0)) {
      return notify(`${terms.opportunitySingular} value must be a positive number or zero.`, true)
    }
    const customFields = { ...customValues }
    for (const field of customFieldDefinitions) {
      const value = customValues[field.key]
      if (field.type === 'number' && value !== '' && value != null) customFields[field.key] = Number(value)
    }
    if (await patchLead(lead.id, { ...business, budget: business.budget === '' ? null : Number(business.budget), customFields })) notify(`${terms.opportunitySingular} details saved`)
  }
  const saveRemarks = async () => { if (await patchLead(lead.id, { remarks })) notify('Remarks saved') }

  const onAddActivity = async (e) => {
    e.preventDefault()
    const f = e.target
    const notes = f.notes.value.trim()
    if (!notes) return notify('Add a note first', true)
    try {
      const a = await addActivity(lead.id, { type: f.type.value, notes, at: new Date().toISOString() })
      setActs((xs) => [a, ...xs]); setAdding(false)
      patchLead(lead.id, { lastActivity: a.at.split('T')[0] })
    } catch (err) { notify('Save failed: ' + err.message, true) }
  }
  const onDelActivity = async (id) => {
    if (!confirm('Delete this entry?')) return
    setActs((xs) => xs.filter((a) => a.id !== id))
    try { await deleteActivity(id) } catch (e) { notify('Delete failed: ' + e.message, true) }
  }

  const firstName = (lead.name || '').split(/\s+/)[0] || 'there'
  const pickEmailTpl = (id) => {
    setMTpl(id)
    const t = tpls.find((x) => String(x.id) === String(id))
    if (t) setMBody((t.body || '').replace(/\{\{name\}\}/g, firstName))
  }

  const canSend = mChannel === 'email'
    ? !!mBody.trim()
    : canSubmitWhatsappDraft(waDraft, waTemplates, waPreference)

  const stopWhatsApp = async () => {
    if (waPreference.suppressed || waStopping) return
    const confirmed = confirm(
      `Stop WhatsApp updates for ${lead.name || `this ${terms.record}`}?\n\n`
      + 'This revokes WhatsApp consent, cancels queued messages, and stops the content pipeline. '
      + `Only continue if the ${terms.record} requested this.`,
    )
    if (!confirmed) return
    setWaStopping(true)
    try {
      const result = await stopLeadWhatsAppUpdates(lead.id, waPreference.recipientE164, countryCode)
      const stoppedAt = result.suppressed_at || new Date().toISOString()
      setWaPreference(normalizeWhatsappPreference({
        ...result,
        consent_whatsapp: false,
        suppressed: true,
        reason: result.reason || 'recipient_request',
        source: result.source || 'recipient',
        suppressed_at: stoppedAt,
        can_send_freeform: false,
      }))
      setWaDraft(emptyWhatsAppDraft())
      if (result.activity?.id) setActs((items) => [result.activity, ...items])
      const stopped = Number(result.stopped_count || 0)
      const cancelled = Number(result.cancelled_count || 0)
      notify(`WhatsApp updates stopped · ${stopped} enrollment${stopped === 1 ? '' : 's'} stopped · ${cancelled} queued message${cancelled === 1 ? '' : 's'} cancelled`)
    } catch (error) {
      await reloadWaPreference()
      notify(error.code === 'recipient_changed'
        ? 'The WhatsApp number changed. Review the current number before stopping updates.'
        : 'Could not stop WhatsApp updates: ' + error.message, true)
    } finally {
      setWaStopping(false)
    }
  }

  const recordWhatsAppConsent = async (confirmation) => {
    if (!lead?.id || !can('messages.recordConsent') || waConsentRecordingRef.current
      || waPreference.loading || waPreference.error || waPreference.suppressed
      || waPreference.consentWhatsapp !== false) return false
    if (waConsentRequestRef.current.leadId !== lead.id || !waConsentRequestRef.current.requestId) {
      waConsentRequestRef.current = { leadId: lead.id, requestId: newWhatsappClientRequestId() }
    }
    const requestId = waConsentRequestRef.current.requestId
    waConsentRecordingRef.current = true
    setWaConsentRecording(true)
    try {
      const result = await recordLeadWhatsAppConsent(
        lead.id, requestId, confirmation, waPreference.recipientE164, countryCode,
      )
      const nextPreference = result?.preference
        ? normalizeWhatsappPreference(result.preference, lead.id)
        : await reloadWaPreference()
      if (!whatsappConsentIsActive(nextPreference)) {
        const error = new Error('WhatsApp consent is still not active. Sending remains blocked.')
        error.code = nextPreference?.suppressed
          ? (nextPreference.source === 'staff' ? 'staff_suppressed' : 'recipient_start_required')
          : 'consent_not_active'
        throw error
      }
      if (result?.preference) setWaPreference(nextPreference)
      waConsentRequestRef.current = { leadId: lead.id, requestId: newWhatsappClientRequestId() }
      setWaDraft(emptyWhatsAppDraft())
      notify('WhatsApp consent recorded. Old cancelled messages remain cancelled; send a fresh approved template when ready.')
      return true
    } catch (error) {
      if (shouldRotateWhatsAppConsentRequest(error.code)) {
        waConsentRequestRef.current = { leadId: lead.id, requestId: newWhatsappClientRequestId() }
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

  const sendMsg = async (e) => {
    e.preventDefault()
    if (mChannel === 'whatsapp' && (waPreference.loading || waPreference.error
      || waPreference.suppressed || waPreference.consentWhatsapp !== true)) {
      return notify(waPreference.suppressed
        ? `WhatsApp updates are stopped for this ${terms.record}`
        : 'WhatsApp sending is unavailable until consent and suppression status are verified', true)
    }
    if (!canSend) return notify(mChannel === 'email' ? 'Write a message first' : 'Pick a template and fill its fields', true)
    setMBusy(true)
    try {
      const payload = mChannel === 'email'
        ? { lead_id: lead.id, channel: 'email', body: mBody.trim() }
        : { lead_id: lead.id, channel: 'whatsapp', ...whatsappDraftPayload(waDraft, waTemplates, lead.name) }
      const m = await sendMessage(payload)
      setMsgs((xs) => xs.some((message) => m.id && message.id === m.id)
        ? xs
        : mergeMessageChange(xs, { eventType: 'INSERT', message: m }, 'asc'))
      setMBody(''); setMTpl(''); setWaDraft(emptyWhatsAppDraft())
      if (mChannel === 'whatsapp') {
        const notice = whatsappSendNotice(m)
        notify(notice.message, notice.error)
      } else notify('Email sent')
    } catch (err) { notify('Could not send: ' + err.message, true) }
    finally { setMBusy(false) }
  }

  const replyTo = (message) => {
    if (!waPreference.canSendFreeform) {
      notify('The 24-hour reply window is closed. Use an approved template.', true)
      return
    }
    setMChannel('whatsapp')
    setWaDraft({
      ...emptyWhatsAppDraft(),
      kind: 'session',
      replyToProviderMessageId: message.provider_message_id || message.wamid || '',
      replyPreview: message.body || 'Attachment',
    })
  }

  const apptWhen = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const onBook = async (e) => {
    e.preventDefault()
    const f = e.target
    if (!f.dt.value) return notify('Pick a date & time', true)
    try {
      const a = await createAppointment({ leadId: lead.id, datetime: new Date(f.dt.value).toISOString(), type: f.type.value })
      setAppts((xs) => [...xs, a].sort((x, y) => new Date(x.datetime) - new Date(y.datetime)))
      setBooking(false)
      notify('Meeting scheduled')
      // leave a trail in the activity log
      try {
        const act = await addActivity(lead.id, { type: 'Meeting', notes: `Meeting (${apptTypeLabel(a.type)}) scheduled for ${apptWhen(a.datetime)}`, at: new Date().toISOString() })
        setActs((xs) => [act, ...xs])
      } catch { /* non-fatal */ }
    } catch (err) { notify('Could not book: ' + err.message, true) }
  }
  const onApptStatus = async (id, status) => {
    setAppts((xs) => xs.map((a) => (a.id === id ? { ...a, status } : a)))
    try { await updateAppointment(id, { status }) } catch (e) { notify('Update failed: ' + e.message, true) }
  }

  const inp = (k, src, set) => ({ value: src[k] ?? '', disabled: !can('leads.edit'), onChange: (e) => set((s) => ({ ...s, [k]: e.target.value })) })

  // read-only attribution values (derived from the lead's captured campaign metadata)
  const srcChannelLabel = lead.sourceChannel ? (SOURCE_CHANNELS.find((s) => s.v === lead.sourceChannel)?.l || lead.sourceChannel) : ''
  const sourceVal = [lead.source, srcChannelLabel].filter(Boolean).join(' · ') || '—'
  const utmVal = [lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(' / ')
  const displayedType = displayLeadTypeLabel(lead, leadTypes)
  const enquiryCategory = leadTypeLabel(lead.leadType, leadTypes)
  // one label / value row; hidden entirely when value is empty (callers force always-on rows with a fallback)
  const attrRow = (label, value, muted) => value ? (
    <div className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)', gap: 12 }}>
      <span className="faint" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>
        {value}{muted ? <span className="faint" style={{ fontSize: 11 }}> · {muted}</span> : null}
      </span>
    </div>
  ) : null

  return (
    <>
      <button className="back" onClick={onBack}><Back /> Back to {backLabel || terms.records}</button>
      <div className="profile">
        {/* header */}
        <div className="pcard">
          <div className="phead">
            <div className="avatar">{initials(lead.name)}</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="pname">{lead.name || 'Unnamed'}</div>
              <div className="pcontact">{[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact info'}</div>
              <div className="pbadges">
                <span className={'pill ' + qualPill(lead.qualStatus)}><span className="dot" />{lead.qualStatus}</span>
                <span className={'pill ' + journeyPill(lead.journeyStatus)}><span className="dot" />{workspaceStageLabel(workspace, lead.journeyStatus)}</span>
                {lead.score !== '' && lead.score != null && <span className="pill neutral">Score {lead.score}</span>}
                <span className={'pill ' + displayLeadTypePill(lead, leadTypes)}>{displayLeadTypeLabel(lead, leadTypes)}</span>
                <span className="faint" style={{ fontSize: 11, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  Added
                  <input type="datetime-local" aria-label="Date and time added" value={toLocalDT(lead.createdAt)} disabled={!can('leads.edit')}
                    onChange={(e) => patchLead(lead.id, { createdAt: e.target.value ? new Date(e.target.value).toISOString() : lead.createdAt })}
                    style={{ height: 26, padding: '1px 6px', fontSize: 12, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink-2)' }} />
                </span>
                {staffName(lead.createdBy) && (
                  <span className="faint" style={{ fontSize: 11, alignSelf: 'center' }}>by {staffName(lead.createdBy)}</span>
                )}
              </div>
              {(lead.company || lead.jobTitle) && <div className="pcontact" style={{ marginTop: 8 }}>{[lead.jobTitle, lead.company].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
          <div className="profile-contact-actions"><CallLeadButton phone={lead.phone} name={lead.name} /></div>
        </div>

        <div className="profile-cards">
        {/* basic info */}
        <div className="pcard sec sec-basic">
          <h3>Basic information</h3>
          <div className="grid2">
            <div className="field"><label>Name</label><input {...inp('name', basic, setBasic)} placeholder="Full name" /></div>
            <div className="field"><label>Phone</label><input {...inp('phone', basic, setBasic)} placeholder={`+${String(countryCode).replace(/^\+/, '')} …`} /></div>
            <div className="field"><label>Email</label><input type="email" {...inp('email', basic, setBasic)} placeholder="email@example.com" /></div>
            <div className="field"><label>Company / organization</label><input {...inp('company', basic, setBasic)} placeholder="Organization name, if applicable" /></div>
            <div className="field"><label>Job title / role</label><input {...inp('jobTitle', basic, setBasic)} placeholder="Role or responsibility" /></div>
            <div className="field"><label>City / location</label><input {...inp('city', basic, setBasic)} placeholder="City or region" /></div>
            <div className="field"><label>Website</label><input {...inp('website', basic, setBasic)} placeholder="https://example.com" /></div>
            <div className="field"><label>Source (free text)</label><input {...inp('source', basic, setBasic)} placeholder="Meta, referral…" /></div>
            <div className="field"><label>Source channel</label>
              <select {...inp('sourceChannel', basic, setBasic)}>
                {SOURCE_CHANNELS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
          </div>
          {can('leads.edit') && <div className="save-row"><button className="btn primary sm" onClick={saveBasic}><Check /> Save basic info</button></div>}
        </div>

        {/* campaign & attribution (read-only, captured at intake) */}
        <div className="pcard sec sec-attribution">
          <h3>Campaign &amp; attribution</h3>
          <div className="stack" style={{ gap: 0 }}>
            {attrRow('Displayed type', displayedType)}
            {displayedType !== enquiryCategory && attrRow(`${terms.recordSingular} category`, enquiryCategory)}
            {attrRow('Source', sourceVal)}
            {attrRow('Platform', lead.platform)}
            {attrRow('Campaign', lead.campaignName, lead.campaignId)}
            {attrRow('Ad set', lead.adsetName)}
            {attrRow('Ad', lead.adName)}
            {attrRow('Meta form', lead.formName, lead.formId)}
            {attrRow('UTM', utmVal)}
            {lead.duplicateCount > 0 && attrRow('Duplicate submissions', lead.duplicateCount)}
            {attrRow('Last contacted', lead.lastContactedAt ? fmtDate(lead.lastContactedAt) : '')}
          </div>
        </div>

        {/* status & score (instant save) */}
        <div className="pcard sec sec-status">
          <h3>Status &amp; score</h3>
          <div className="grid2">
            <div className="field"><label>Qualification</label>
              <select value={lead.qualStatus} disabled={!can('leads.edit')} onChange={(e) => patchLead(lead.id, { qualStatus: e.target.value })}>
                {QUAL.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>{terms.recordSingular} category</label>
              <select value={lead.leadType || 'general'} disabled={!can('leads.edit')} onChange={(e) => patchLead(lead.id, { leadType: e.target.value })}>
                {leadTypeOpts.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Pipeline stage</label>
              <select aria-label="Pipeline stage" value={lead.journeyStatus} disabled={!can('leads.edit')} onChange={(e) => setJourney(e.target.value)}>
                {stageOptions.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
              </select>
            </div>
            <div className="field"><label>{terms.recordSingular} score (0–100)</label>
              <input type="number" min="0" max="100" defaultValue={lead.score} disabled={!can('leads.edit')}
                onBlur={(e) => patchLead(lead.id, { score: clampScore(e.target.value) })} placeholder="e.g. 75" />
            </div>
            <div className="field"><label>Assigned to</label>
              <select value={lead.assignedTo || ''} disabled={!can('leads.edit')} onChange={(e) => patchLead(lead.id, { assignedTo: e.target.value })}>
                <option value="">Unassigned</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name || p.role}</option>)}
              </select>
            </div>
            <div className="field"><label>Priority</label>
              <select value={lead.priority || ''} disabled={!can('leads.edit')} onChange={(e) => patchLead(lead.id, { priority: e.target.value })}>
                <option value="">None</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="field"><label>Next follow-up</label>
              <div className="profile-followup-fields">
                <input type="date" style={{ flex: 1 }} value={(lead.followupDate || '').slice(0, 10)} disabled={!can('leads.edit')}
                  onChange={(e) => patchLead(lead.id, { followupDate: e.target.value })} />
                <input type="time" value={lead.followupTime || ''} disabled={!can('leads.edit')}
                  onChange={(e) => patchLead(lead.id, { followupTime: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        {/* appointments */}
        <div className="pcard sec sec-appt">
          <h3>Meetings
            {can('leads.edit') && <button className="btn sm" onClick={() => setBooking((b) => !b)}><Plus /> Schedule</button>}
          </h3>
          {booking && (
            <form className="act" onSubmit={onBook} style={{ marginBottom: 12 }}>
              <div className="grid2">
                <div className="field"><label>Date &amp; time</label><input name="dt" type="datetime-local" autoFocus /></div>
                <div className="field"><label>Type</label>
                  <select name="type" defaultValue="in_person">{APPT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn ghost sm" onClick={() => setBooking(false)}>Cancel</button>
                <button type="submit" className="btn primary sm"><Check /> Schedule</button>
              </div>
            </form>
          )}
          {appts.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}><p>No meetings yet.</p></div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {appts.map((a) => (
                <div key={a.id} className="row-between" style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{apptWhen(a.datetime)}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{apptTypeLabel(a.type)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {can('leads.edit') ? (
                      <select className="mini-select" value={a.status === 'attended' ? 'completed' : a.status} onChange={(e) => onApptStatus(a.id, e.target.value)} aria-label="Meeting status">
                        {APPT_STATUSES.map((s) => <option key={s} value={s}>{apptStatusLabel(s)}</option>)}
                      </select>
                    ) : (
                      <span className={'pill ' + apptStatusPill(a.status)}><span className="dot" />{apptStatusLabel(a.status)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* remarks */}
        <div className="pcard sec sec-remarks">
          <h3>Remarks</h3>
          <div className="field"><textarea value={remarks} disabled={!can('leads.edit')} onChange={(e) => setRemarks(e.target.value)} placeholder="Key context…" /></div>
          {can('leads.edit') && <div className="save-row"><button className="btn primary sm" onClick={saveRemarks}><Check /> Save remarks</button></div>}
        </div>

        {/* Shared business context and fields configured for this workspace. */}
        <form className="pcard sec sec-opportunity" onSubmit={saveBusiness}>
          <h3>{terms.opportunitySingular} details</h3>
          <div className="grid2">
            <div className="field"><label>Product / service interest</label><input {...inp('interest', business, setBusiness)} placeholder="What are they looking for?" disabled={!can('leads.edit')} /></div>
            <div className="field"><label>{terms.opportunitySingular} value ({business.currency || workspace?.currency || 'USD'})</label><input type="number" min="0" step="0.01" {...inp('budget', business, setBusiness)} placeholder="Optional estimated value" disabled={!can('leads.edit')} /></div>
            <div className="field"><label>Expected close date</label><input type="date" {...inp('expectedCloseDate', business, setBusiness)} disabled={!can('leads.edit')} /></div>
            {customFieldDefinitions.map((field) => <div className="field" key={field.key}>
              <label htmlFor={`profile-custom-${field.key}`}>{field.label}</label>
              {field.type === 'select' ? <select id={`profile-custom-${field.key}`} {...inp(field.key, customValues, setCustomValues)} disabled={!can('leads.edit')}>
                <option value="">Select…</option>
                {customValues[field.key] && !(field.options || []).includes(customValues[field.key]) && <option>{customValues[field.key]}</option>}
                {(field.options || []).map((option) => <option key={option}>{option}</option>)}
              </select> : <input id={`profile-custom-${field.key}`} type={['number', 'date'].includes(field.type) ? field.type : 'text'} step={field.type === 'number' ? 'any' : undefined} {...inp(field.key, customValues, setCustomValues)} disabled={!can('leads.edit')} />}
            </div>)}
          </div>
          {can('leads.edit') && <div className="save-row"><button type="submit" className="btn primary sm"><Check /> Save {terms.opportunity}</button></div>}
        </form>

        {/* messages — WhatsApp / email with this lead */}
        <div className="pcard sec sec-messages">
          <h3>Messages</h3>
          <WhatsAppPreferenceBanner preference={waPreference} canOptOut={can('messages.optOut')}
            stopping={waStopping} onStop={stopWhatsApp}
            canRecordConsent={can('messages.recordConsent')} recordingConsent={waConsentRecording}
            onRecordConsent={recordWhatsAppConsent} />
          {msgs.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}><p>No messages with this {terms.record} yet.</p></div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {msgs.map((m) => (
                <WhatsAppMessageBubble key={m.id} message={m} maxWidth="100%" onReply={replyTo}
                  time={`${fmtDate(m.at)} · ${new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`} />
              ))}
            </div>
          )}
          {can('messages.send') && (
            <form onSubmit={sendMsg} style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <select className="mini-select" value={mChannel} onChange={(e) => {
                  setMChannel(e.target.value)
                  if (e.target.value !== 'whatsapp') setWaDraft(emptyWhatsAppDraft())
                }} aria-label="Channel">
                  {CHANNELS.filter((c) => c.v !== 'ai' && c.v !== 'sms').map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
                {mChannel === 'email' && (
                  <select className="mini-select" value={mTpl} onChange={(e) => pickEmailTpl(e.target.value)} aria-label="Use a template" style={{ maxWidth: 220 }}>
                    <option value="">Use a template…</option>
                    {tpls.filter((t) => t.channel === 'email').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>

              {mChannel === 'whatsapp' ? (
                <WhatsAppComposer key={lead.id} draft={waDraft} onChange={setWaDraft} templates={waTemplates}
                  templatesLoading={waTemplatesLoading} templatesError={waTemplatesError}
                  preference={waPreference} leadName={lead.name} disabled={mBusy} />
              ) : (
                <textarea value={mBody} onChange={(e) => setMBody(e.target.value)}
                  placeholder="Write an email…" style={{ minHeight: 72 }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="submit" className="btn primary sm" disabled={mBusy || !canSend}><Send /> {mBusy ? 'Queuing…' : 'Send'}</button>
              </div>
            </form>
          )}
        </div>

        {/* activity log */}
        <div className="pcard sec sec-activity">
          <h3>Activity log
            <button className="btn sm" onClick={() => setAdding((a) => !a)}><Plus /> Add update</button>
          </h3>
          {adding && (
            <form className="act" onSubmit={onAddActivity} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <div className="field" style={{ minWidth: 130 }}><label>Type</label>
                  <select name="type">{ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                </div>
              </div>
              <div className="field"><label>Notes</label><textarea name="notes" placeholder="Describe the interaction…" /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
                <button type="submit" className="btn primary sm"><Check /> Save</button>
              </div>
            </form>
          )}
          {acts.length === 0 && <div className="empty" style={{ padding: 20 }}><p>No activity logged yet.</p></div>}
          {acts.map((a) => (
            <div className="act" key={a.id}>
              <div className="head">
                <span className="when">
                  {fmtDate(a.at)} · {new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {staffName(a.by) ? ' · ' + staffName(a.by) : ''}
                </span>
                <button className="icon-btn" onClick={() => onDelActivity(a.id)} aria-label="Delete entry"><Trash /></button>
              </div>
              <span className={'tag ' + a.type}>{a.type}</span>
              <div className="notes">{a.notes}</div>
            </div>
          ))}
        </div>
        </div>
      </div>
    </>
  )
}
