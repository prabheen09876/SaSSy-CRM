import { useEffect, useId, useState } from 'react'
import { useApp } from '../App.jsx'
import { hasConfig } from '../lib/supabase'
import { Check } from '../lib/icons.jsx'
import { customFieldKey, INDUSTRY_PRESETS, normalizeWorkspace, workspaceTerminology, workspaceStageOptions } from '../lib/workspace'
import './workspace.css'

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'CNY', 'NZD', 'ZAR', 'CHF', 'SAR', 'BRL', 'MXN']
const FIELD_TYPES = [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'select', label: 'Dropdown' }]
const STAGE_ROLES = { 'New Lead': 'New record', Discovery: 'Initial conversation', 'Proposal Sent': 'Proposal or options', Negotiation: 'Decision in progress', 'Follow-up Ongoing': 'Ongoing follow-up', 'Closed Won': 'Successful outcome', 'Closed Lost': 'Unsuccessful outcome', 'Not Interested': 'Not interested', Unresponsive: 'No response' }

function ProfileField({ label, children, ...props }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label>{children ? children(id) : <input id={id} {...props} />}</div>
}

export function WorkspaceProfileForm({ setup = false, editable = true, onComplete }) {
  const { workspace, saveWorkspace, notify } = useApp()
  const [draft, setDraft] = useState(() => normalizeWorkspace(workspace))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newField, setNewField] = useState({ label: '', type: 'text', options: '' })
  useEffect(() => { setDraft(normalizeWorkspace(workspace)) }, [workspace])
  const patch = (fields) => { setDraft((current) => ({ ...current, ...fields })); setError('') }
  const preset = INDUSTRY_PRESETS.find((item) => item.id === draft.industry) || INDUSTRY_PRESETS[0]
  const language = setup ? preset : draft
  const terms = workspaceTerminology(language)
  const stages = workspaceStageOptions(language)
  const remainingPresetFields = preset.customFields.filter((field) => !draft.customFields.some((existing) => existing.key === field.key))

  const addPresetFields = () => {
    if (draft.customFields.length + remainingPresetFields.length > 50) {
      setError(`This preset adds ${remainingPresetFields.length} fields, which would exceed the 50-field limit. Remove unused fields first.`)
      return
    }
    patch({ customFields: [...draft.customFields, ...remainingPresetFields.map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }))] })
  }
  const usePresetLanguage = () => patch({ terminology: { ...preset.terminology }, stageLabels: { ...preset.stageLabels } })
  const updateTerm = (key, value) => patch({ terminology: { ...draft.terminology, [key]: value } })
  const updateField = (key, fields) => patch({ customFields: draft.customFields.map((field) => field.key === key ? { ...field, ...fields } : field) })
  const addField = () => {
    const label = newField.label.trim()
    const key = customFieldKey(label)
    const options = [...new Set(newField.options.split('\n').map((option) => option.trim()).filter(Boolean))]
    if (!label || !key) { setError('Enter a field name with at least one letter or number.'); return }
    if (['constructor', 'prototype', '__proto__'].includes(key)) { setError('Choose a different field name.'); return }
    if (draft.customFields.some((field) => field.key === key)) { setError('A field with this name already exists. Choose a different name.'); return }
    if (newField.type === 'select' && !options.length) { setError('Add at least one dropdown option.'); return }
    if (newField.type === 'select' && options.length > 50) { setError('A dropdown can have up to 50 options.'); return }
    if (draft.customFields.length >= 50) { setError('A workspace can have up to 50 custom fields.'); return }
    patch({ customFields: [...draft.customFields, { key, label, type: newField.type, ...(newField.type === 'select' ? { options } : {}) }] })
    setNewField({ label: '', type: 'text', options: '' })
  }

  const save = async (event) => {
    event.preventDefault()
    if (!editable || busy) return
    if (!draft.name.trim()) { setError('Enter your business or workspace name.'); return }
    if (draft.customFields.length > 50) { setError('A workspace can have up to 50 custom fields. Remove unused fields before saving.'); return }
    if (draft.customFields.some((field) => field.type === 'select' && new Set(field.options?.map((option) => option.trim()).filter(Boolean)).size > 50)) {
      setError('Each dropdown can have up to 50 options. Remove unused options before saving.'); return
    }
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) { setError('Enter a three-letter currency code, such as INR, USD, or EUR.'); return }
    if (!/^[1-9]\d{0,2}$/.test(draft.countryCode.replace(/^\+/, ''))) { setError('Enter a country calling code such as 91, 1, or 44.'); return }
    if (!setup && Object.values(draft.terminology).some((value) => !value.trim())) { setError('Give each record and opportunity label a name.'); return }
    if (!setup && Object.values(draft.stageLabels).some((value) => !value.trim())) { setError('Every pipeline stage needs a name.'); return }
    if (!setup && new Set(Object.values(draft.stageLabels).map((value) => value.trim().toLocaleLowerCase())).size !== stages.length) {
      setError('Give each pipeline stage a different name so your team can distinguish them.'); return
    }
    if (!setup && stages.some((stage) => stages.some((other) => other.value !== stage.value && other.value.toLocaleLowerCase() === draft.stageLabels[stage.value].trim().toLocaleLowerCase()))) {
      setError('A stage cannot use the original name of another stage. Choose a distinct name to keep spreadsheet imports unambiguous.'); return
    }
    if (draft.customFields.some((field) => !field.label.trim() || (field.type === 'select' && !field.options?.some((option) => option.trim())))) {
      setError('Every custom field needs a name, and dropdowns need at least one option.'); return
    }
    const savedFields = setup && !draft.customFields.length ? preset.customFields : draft.customFields
    setBusy(true)
    setError('')
    try {
      await saveWorkspace(normalizeWorkspace({ ...draft, customFields: savedFields,
        ...(setup ? { terminology: { ...preset.terminology }, stageLabels: { ...preset.stageLabels } } : {}), setupComplete: true }))
      notify(setup ? 'Your workspace is ready' : 'Workspace settings saved')
      onComplete?.()
    } catch (saveError) {
      setError(saveError?.message || 'Could not save workspace settings. Please try again.')
    } finally { setBusy(false) }
  }

  return <form className="workspace-profile" onSubmit={save}>
    <fieldset disabled={!editable || busy}>
      <div className="grid2">
        <ProfileField label="Business / workspace name" value={draft.name} maxLength={160} onChange={(event) => patch({ name: event.target.value })} autoComplete="organization" required placeholder="Your business name" />
        <ProfileField label="Industry">{(id) => <select id={id} value={draft.industry} onChange={(event) => patch({ industry: event.target.value })}>{INDUSTRY_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</ProfileField>
        <ProfileField label="Currency code">{(id) => <><input id={id} list={`${id}-codes`} value={draft.currency} maxLength={3} pattern="[A-Za-z]{3}" required placeholder="e.g. INR" onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} /><datalist id={`${id}-codes`}>{CURRENCIES.map((currency) => <option key={currency} value={currency} />)}</datalist></>}</ProfileField>
        <ProfileField label="Default country calling code" value={draft.countryCode} maxLength={4} inputMode="tel" placeholder="91" onChange={(event) => patch({ countryCode: event.target.value })} required />
        {!setup && <>
          <ProfileField label="Business phone" value={draft.phone} type="tel" maxLength={40} autoComplete="tel" onChange={(event) => patch({ phone: event.target.value })} />
          <ProfileField label="City / location" value={draft.city} maxLength={100} autoComplete="address-level2" onChange={(event) => patch({ city: event.target.value })} />
          <ProfileField label="Website" value={draft.website} maxLength={300} placeholder="example.com" onChange={(event) => patch({ website: event.target.value })} />
        </>}
      </div>

      <div className="workspace-blueprint" aria-label="Workspace preview">
        <div className="workspace-blueprint-head"><strong>{setup ? preset.label : 'Your workflow'}</strong><span>Live preview</span></div>
        <p>{setup ? preset.description : `${terms.recordPlural} and ${terms.opportunities}, in your team's language.`}</p>
        <div className="workspace-blueprint-nav"><strong>{terms.recordPlural}</strong><span>Pipeline</span><span>Calendar</span></div>
        <div className="workspace-blueprint-stages" aria-label="Pipeline preview">{stages.slice(0, 4).map((stage) => <span key={stage.value}>{stage.label}</span>)}<span className="workspace-blueprint-outcome">{stages.find((stage) => stage.value === 'Closed Won')?.label}</span></div>
        {setup && preset.customFields.length > 0 && <p>Starter fields: {preset.customFields.map((field) => field.label).join(', ')}.</p>}
        {setup && <p className="workspace-help">You can change these names and add your own fields in Settings.</p>}
      </div>

      {!setup && <>
      <section className="workspace-language">
        <div className="workspace-section-head"><div><h3>Your CRM language</h3><p>Use names your team already knows. They appear in navigation, records, and reports.</p></div>
          <button type="button" className="btn sm" onClick={usePresetLanguage}>Use industry language</button>
        </div>
        <div className="grid2">
          <ProfileField label="One record" value={draft.terminology.recordSingular} maxLength={40} placeholder="e.g. Client" onChange={(event) => updateTerm('recordSingular', event.target.value)} />
          <ProfileField label="Multiple records" value={draft.terminology.recordPlural} maxLength={40} placeholder="e.g. Clients" onChange={(event) => updateTerm('recordPlural', event.target.value)} />
          <ProfileField label="One opportunity" value={draft.terminology.opportunitySingular} maxLength={40} placeholder="e.g. Project" onChange={(event) => updateTerm('opportunitySingular', event.target.value)} />
          <ProfileField label="Multiple opportunities" value={draft.terminology.opportunityPlural} maxLength={40} placeholder="e.g. Projects" onChange={(event) => updateTerm('opportunityPlural', event.target.value)} />
        </div>
        <div className="workspace-section-head workspace-stage-head"><div><h3>Pipeline names</h3><p>Rename each stage to fit your process. Existing records and reporting stay connected.</p></div></div>
        <div className="workspace-stage-fields">{stages.map((stage) => <ProfileField key={stage.value} label={STAGE_ROLES[stage.value]} value={draft.stageLabels[stage.value]} maxLength={60}
          onChange={(event) => patch({ stageLabels: { ...draft.stageLabels, [stage.value]: event.target.value } })} />)}</div>
      </section>
      <div className="workspace-custom-fields">
        <div className="workspace-section-head"><div><h3>Custom fields</h3><p>Choose the details your business needs. These fields appear on every {terms.record}.</p></div>
          {remainingPresetFields.length > 0 && <button type="button" className="btn sm" onClick={addPresetFields}>Add {preset.label.toLowerCase()} fields</button>}
        </div>
        {draft.customFields.length === 0 && <p className="workspace-field-empty">No custom fields yet. Use an industry preset or add your own below.</p>}
        {draft.customFields.map((field) => <div className="workspace-custom-field" key={field.key}>
          <ProfileField label="Field name" value={field.label} maxLength={80} onChange={(event) => updateField(field.key, { label: event.target.value })} />
          <div className="workspace-field-type"><span>{FIELD_TYPES.find((type) => type.value === field.type)?.label}</span><small>Saved on {terms.records}</small></div>
          <button type="button" className="btn ghost sm" aria-label={`Remove ${field.label}`} onClick={() => patch({ customFields: draft.customFields.filter((item) => item.key !== field.key) })}>Remove</button>
          {field.type === 'select' && <ProfileField label="Dropdown options (one per line)">{(id) => <textarea id={id} rows={3} value={field.options?.join('\n') || ''} onChange={(event) => updateField(field.key, { options: event.target.value.split('\n') })} />}</ProfileField>}
        </div>)}
        {draft.customFields.length > 0 && <p className="workspace-help">Removing a field hides it from {terms.records}. Previously saved values stay in the record.</p>}
        <div className="workspace-new-field">
          <ProfileField label="New field name" value={newField.label} maxLength={80} placeholder="e.g. Contract renewal date" onChange={(event) => setNewField((current) => ({ ...current, label: event.target.value }))} />
          <ProfileField label="Field type">{(id) => <select id={id} value={newField.type} onChange={(event) => setNewField((current) => ({ ...current, type: event.target.value }))}>{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>}</ProfileField>
          <button type="button" className="btn sm" onClick={addField}>Add field</button>
          {newField.type === 'select' && <ProfileField label="Dropdown options (one per line)">{(id) => <textarea id={id} rows={3} value={newField.options} onChange={(event) => setNewField((current) => ({ ...current, options: event.target.value }))} placeholder={'Option one\nOption two'} />}</ProfileField>}
        </div>
      </div></>}
    </fieldset>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <div className="workspace-save-row">
      <p className="workspace-help">{hasConfig ? 'Settings are shared with your team in this workspace.' : 'Saved in this browser. Connect your own backend for team access and shared data.'}</p>
      <button type="submit" className="btn primary" disabled={!editable || busy}><Check /> {busy ? 'Saving…' : setup ? 'Create workspace' : 'Save workspace'}</button>
    </div>
  </form>
}

export default function WorkspaceSetup({ onComplete }) {
  return <div className="workspace-setup"><div className="workspace-setup-card">
    <h1>A CRM shaped around your business.</h1>
    <p className="workspace-intro">Choose a starting point for your team. Your workspace gets the right vocabulary, pipeline names, and fields for the way you work.</p>
    <WorkspaceProfileForm setup onComplete={onComplete} />
  </div></div>
}
