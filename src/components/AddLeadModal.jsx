import { useEffect, useId, useState, useRef } from 'react'
import { useApp } from '../App.jsx'
import { QUAL, SOURCE_CHANNELS, LEAD_TYPES_FALLBACK } from '../lib/constants'
import { insertLead, clampScore } from '../lib/db'
import { DEFAULT_WORKSPACE, workspaceStageOptions, workspaceTerminology } from '../lib/workspace'
import {
  explicitWhatsAppConsent,
  leadCreatedWhatsAppNotice,
  normalizeWhatsAppPhone,
  normalizeRecordPhone,
  WHATSAPP_STAFF_ATTESTATION_DETAIL,
  WHATSAPP_STAFF_ATTESTATION_HELP,
  WHATSAPP_STAFF_ATTESTATION_TITLE,
} from '../lib/whatsappSafety'
import { X, Plus } from '../lib/icons.jsx'

export default function AddLeadModal({ onClose, onAdded }) {
  const { notify, leadTypes, can, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const stageOptions = workspaceStageOptions(workspace)
  const customFields = workspace?.customFields || []
  const types = leadTypes && leadTypes.length ? leadTypes : LEAD_TYPES_FALLBACK
  const [busy, setBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [consentWhatsapp, setConsentWhatsapp] = useState(false)
  const submitting = useRef(false)   // ref latch: guards against Enter-key double-submit before `busy` re-renders
  const nameInput = useRef(null)
  const dialogId = useId()
  const fieldId = (name) => `${dialogId}-${name}`
  const countryCode = workspace?.countryCode || DEFAULT_WORKSPACE.countryCode
  const normalizedWhatsappPhone = normalizeWhatsAppPhone(phone, countryCode)
  const canManageWhatsAppConsent = can('messages.recordConsent')
  const canRecordWhatsAppConsent = canManageWhatsAppConsent && Boolean(normalizedWhatsappPhone)

  useEffect(() => {
    const trigger = document.activeElement
    nameInput.current?.focus()
    return () => { if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus() }
  }, [])

  const close = () => { if (!submitting.current) onClose() }

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden && element.getClientRects().length > 0)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first) {
      event.preventDefault()
      event.currentTarget.focus()
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
      event.preventDefault()
      first.focus()
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    const f = e.target
    if (!f.name.value.trim()) return notify('Name is required', true)
    const enteredPhone = phone.trim()
    if (consentWhatsapp && !canManageWhatsAppConsent) {
      return notify('Only a manager can record WhatsApp consent.', true)
    }
    if (consentWhatsapp && !normalizedWhatsappPhone) {
      return notify('Enter a valid WhatsApp number with its country code.', true)
    }
    submitting.current = true
    setBusy(true)
    try {
      const lead = await insertLead(normalizeRecordPhone({
        name: f.name.value.trim(),
        phone: enteredPhone,
        email: f.email.value.trim(),
        company: f.company.value.trim(),
        jobTitle: f.jobTitle.value.trim(),
        city: f.city.value.trim(),
        website: f.website.value.trim(),
        interest: f.interest.value.trim(),
        budget: f.budget.value === '' ? null : Number(f.budget.value),
        currency: workspace?.currency || 'USD',
        expectedCloseDate: f.expectedCloseDate.value || '',
        customFields: Object.fromEntries(customFields.map((field) => {
          const value = f.elements.namedItem(`custom:${field.key}`)?.value ?? ''
          return [field.key, field.type === 'number' && value !== '' ? Number(value) : value]
        })),
        sourceChannel: f.sourceChannel.value,
        leadType: f.leadType.value,
        qualStatus: f.qual.value,
        journeyStatus: f.journey.value,
        score: clampScore(f.score.value),
        followupDate: f.fdate.value.trim(),
        followupTime: f.ftime.value,
        remarks: f.remarks.value.trim(),
        consentWhatsapp: explicitWhatsAppConsent(consentWhatsapp),
      }, countryCode))
      const notice = leadCreatedWhatsAppNotice({
        hasPhone: Boolean(enteredPhone),
        consentRequested: consentWhatsapp,
        welcomeQueued: lead.welcomeQueued,
        welcomeStatus: lead.welcomeStatus,
      })
      notify(notice.message.replace(/^Lead\b/, () => terms.recordSingular), notice.error)
      onAdded(lead)
    } catch (err) { notify(`Could not add ${terms.record}: ` + err.message, true); submitting.current = false; setBusy(false) }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={fieldId('heading')} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
        <div className="mhead"><h2 id={fieldId('heading')}>Add {terms.record}</h2><button type="button" className="icon-btn" onClick={close} disabled={busy} aria-label="Close"><X /></button></div>
        <div className="mbody">
          <div className="grid2">
            <div className="field"><label htmlFor={fieldId('name')}>Name *</label><input id={fieldId('name')} ref={nameInput} name="name" required placeholder="Full name" /></div>
            <div className="field"><label htmlFor={fieldId('phone')}>Phone</label><input id={fieldId('phone')} name="phone" value={phone}
              onChange={(event) => {
                const nextPhone = event.target.value
                setPhone(nextPhone)
                // The attestation belongs to the exact recipient shown when it
                // was checked. Any edit requires it to be confirmed again.
                if (consentWhatsapp) setConsentWhatsapp(false)
              }} inputMode="tel" autoComplete="tel" placeholder={`+${String(countryCode).replace(/^\+/, '')} …`} /></div>
            <div className="field"><label htmlFor={fieldId('email')}>Email</label><input id={fieldId('email')} name="email" type="email" placeholder="email@example.com" /></div>
            <div className="field"><label htmlFor={fieldId('company')}>Company / organization</label><input id={fieldId('company')} name="company" placeholder="Organization name, if applicable" /></div>
            <div className="field"><label htmlFor={fieldId('jobTitle')}>Job title / role</label><input id={fieldId('jobTitle')} name="jobTitle" placeholder="Role or decision-making responsibility" /></div>
            <div className="field"><label htmlFor={fieldId('city')}>City / location</label><input id={fieldId('city')} name="city" placeholder="City or region" /></div>
            <div className="field"><label htmlFor={fieldId('website')}>Website</label><input id={fieldId('website')} name="website" placeholder="https://example.com" /></div>
            <div className="field"><label htmlFor={fieldId('interest')}>Product / service interest</label><input id={fieldId('interest')} name="interest" placeholder="What are they looking for?" /></div>
            <div className="field"><label htmlFor={fieldId('budget')}>{terms.opportunitySingular} value ({workspace?.currency || 'USD'})</label><input id={fieldId('budget')} name="budget" type="number" min="0" step="0.01" placeholder="Optional estimated value" /></div>
            <div className="field"><label htmlFor={fieldId('expectedCloseDate')}>Expected close date</label><input id={fieldId('expectedCloseDate')} name="expectedCloseDate" type="date" /></div>
            <div className="field"><label htmlFor={fieldId('sourceChannel')}>Source channel</label>
              <select id={fieldId('sourceChannel')} name="sourceChannel">{SOURCE_CHANNELS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
            </div>
            <div className="field"><label htmlFor={fieldId('leadType')}>{terms.recordSingular} type</label>
              <select id={fieldId('leadType')} name="leadType" defaultValue="general">{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            </div>
            <div className="field"><label htmlFor={fieldId('score')}>{terms.recordSingular} score</label><input id={fieldId('score')} name="score" type="number" min="0" max="100" placeholder="e.g. 75" /></div>
            <div className="field"><label htmlFor={fieldId('qual')}>Qualification</label><select id={fieldId('qual')} name="qual">{QUAL.map((o) => <option key={o}>{o}</option>)}</select></div>
            <div className="field"><label htmlFor={fieldId('journey')}>Pipeline stage</label><select id={fieldId('journey')} name="journey">{stageOptions.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></div>
            <div className="field"><label htmlFor={fieldId('fdate')}>Follow-up date</label><input id={fieldId('fdate')} name="fdate" type="date" /></div>
            <div className="field"><label htmlFor={fieldId('ftime')}>Follow-up time</label><input id={fieldId('ftime')} name="ftime" type="time" /></div>
          </div>
          {customFields.length > 0 && <>
            <h3 style={{ margin: '20px 0 12px', fontSize: 14 }}>Workspace fields</h3>
            <div className="grid2">{customFields.map((field) => <div className="field" key={field.key}>
              <label htmlFor={fieldId(`custom-${field.key}`)}>{field.label}</label>
              {field.type === 'select' ? <select id={fieldId(`custom-${field.key}`)} name={`custom:${field.key}`}>
                <option value="">Select…</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}
              </select> : <input id={fieldId(`custom-${field.key}`)} name={`custom:${field.key}`} type={['number', 'date'].includes(field.type) ? field.type : 'text'} step={field.type === 'number' ? 'any' : undefined} />}
            </div>)}</div>
          </>}
          <div className="field" style={{ marginTop: 12 }}><label htmlFor={fieldId('remarks')}>Remarks</label><textarea id={fieldId('remarks')} name="remarks" placeholder="Key context…" /></div>
          <div className="lead-consent">
            <label className="lead-consent-choice" htmlFor={fieldId('consentWhatsapp')}>
              <input id={fieldId('consentWhatsapp')} name="consentWhatsapp" type="checkbox" checked={consentWhatsapp}
                aria-describedby={fieldId('consent-help')}
                disabled={!canRecordWhatsAppConsent}
                onChange={(event) => setConsentWhatsapp(event.target.checked)} />
              <span>
                <strong>{WHATSAPP_STAFF_ATTESTATION_TITLE}</strong>
                <small>{WHATSAPP_STAFF_ATTESTATION_DETAIL}</small>
              </span>
            </label>
            <p id={fieldId('consent-help')}>{canRecordWhatsAppConsent
              ? WHATSAPP_STAFF_ATTESTATION_HELP
              : canManageWhatsAppConsent
                ? 'Enter a valid WhatsApp phone number before recording consent.'
                : 'A manager must record verified WhatsApp consent.'}</p>
          </div>
        </div>
        <div className="mfoot">
          <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}><Plus /> {busy ? 'Adding…' : `Add ${terms.record}`}</button>
        </div>
      </form>
    </div>
  )
}
