import { useState, useEffect, useId } from 'react'
import { useApp } from '../App.jsx'
import { roleLabel, rolePill } from '../lib/auth'
import { SOURCE_CHANNELS } from '../lib/constants'
import { hasConfig } from '../lib/supabase'
import {
  loadHealth,
  syncWhatsappTemplates,
  deleteWhatsappQuickReplyRule,
  loadWhatsappQuickReplyRules,
  loadWhatsappQuickReplyRuns,
  saveWhatsappQuickReplyRule,
  loadLeadTypes, upsertLeadType, deleteLeadType,
  loadLeadForms, upsertLeadForm, deleteLeadForm,
} from '../lib/db'
import { Chat, Mail, Sparkle, Shield, Check, Lock, Users, FileText, Sun, Settings as SettingsIcon } from '../lib/icons.jsx'
import ChangePasswordModal from './ChangePasswordModal.jsx'
import { WorkspaceProfileForm } from './WorkspaceSetup.jsx'
import ConnectionSettings from './ConnectionSettings.jsx'
import SaasTeam from './SaasTeam.jsx'
import Team from './Team.jsx'
import AppearanceSettings from './AppearanceSettings.jsx'
import './settings.css'

function ChStatus({ tone, children }) {
  return <span className={'pill ' + tone}><span className="dot" />{children}</span>
}

const PRIVACY = [
  'Use only the customer details your team needs in custom fields.',
  'Record messaging consent before contacting someone.',
  'Review team access when people join, change roles, or leave your business.',
]

function Field({ label, value, onChange, disabled, ...rest }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} {...rest} />
    </div>
  )
}

function ChannelRow({ icon, title, desc, right }) {
  return (
    <div className="line-row">
      <div className="lr-main">
        <span className="lr-ico">{icon}</span>
        <div>
          <div className="lr-t">{title}</div>
          <div className="lr-d">{desc}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{right}</div>
    </div>
  )
}

const healthTime = (value) => value
  ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : 'No event received'

function WhatsAppHealthDetails({ info }) {
  const issues = Array.isArray(info.templateIssues) ? info.templateIssues : []
  const templateText = info.templatesReady === true
    ? `${info.approvedTemplates ?? 'Approved'} ready`
    : info.approvedTemplates != null
      ? `${info.approvedTemplates} approved${info.requiredTemplates != null ? ` / ${info.requiredTemplates} required` : ''}${issues.length ? ` · ${issues.length} need attention` : ''}`
      : 'Awaiting template sync'
  const queueState = info.queueReady === true ? 'Queue ready' : info.queueReady === false ? 'Queue unavailable' : 'Queue state unavailable'
  const queueParts = [queueState]
  if (info.pendingCount != null) queueParts.push(`${info.pendingCount} pending`)
  if (info.reviewCount != null) queueParts.push(`${info.reviewCount} review`)
  if (info.backlogCount != null) queueParts.push(`${info.backlogCount} queued at Cloudflare`)
  queueParts.push(info.dlqCount != null ? `${info.dlqCount} in DLQ` : 'DLQ unavailable')
  const issueText = issues.slice(0, 4).map((issue) => {
    const reason = issue.components_sync_required
      ? 'component sync required'
      : issue.rejection_reason || String(issue.status || 'not ready').replaceAll('_', ' ')
    return `${issue.template_key} (${reason})`
  }).join(' · ')
  const webhookState = !info.webhookSecured
    ? 'Needs attention'
    : info.webhookFailedCount > 0
        ? 'Processing failures'
      : info.webhookStale
        ? 'Signed; last event stale'
        : info.webhookReady
          ? 'Signed & processing'
        : info.webhookVerified
          ? 'Signed; backlog pending'
          : 'Signed; waiting for event'
  const webhookDetail = [
    info.webhookPendingCount != null ? `${info.webhookPendingCount} pending` : '',
    info.webhookFailedCount != null ? `${info.webhookFailedCount} failed` : '',
  ].filter(Boolean).join(' · ')
  return (
    <>
      <div className="channel-health-grid" aria-label="WhatsApp integration health">
        <div><span>Provider</span><strong>{info.active ? 'Meta Cloud API' : info.provider ? `${info.provider} (legacy)` : 'Unavailable'}</strong></div>
        <div><span>OTP</span><strong>{info.otpProvider === 'meta' ? 'Meta Cloud API' : info.otpProvider ? `${info.otpProvider} (cutover needed)` : 'Unavailable'}</strong></div>
        <div><span>Webhook</span><strong title={webhookDetail}>{webhookState}</strong></div>
        <div><span>Last received</span><strong>{healthTime(info.lastEventAt)}</strong></div>
        <div><span>Last processed</span><strong>{healthTime(info.lastProcessedAt)}</strong></div>
        <div><span>Templates</span><strong>{templateText}</strong></div>
        <div><span>Delivery</span><strong title={queueParts.join(' · ')}>{queueParts.join(' · ')}</strong></div>
      </div>
      {issueText && <p className="channel-health-note" title={issueText}>Template attention: {issueText}</p>}
    </>
  )
}

const QUICK_REPLY_ACTIONS = {
  notify_assignee: 'Notify record owner',
  create_followup_task: 'Create follow-up task',
  send_session_text: 'Send a 24-hour reply',
  send_template: 'Send an approved template',
}

const newQuickReplyRule = () => ({
  id: '',
  name: '',
  enabled: true,
  source_template_key: '',
  reply_key: '',
  action_type: 'notify_assignee',
  action_config: {},
  priority: 100,
})

const normalizeQuickReplyRule = (rule = {}) => ({
  ...newQuickReplyRule(),
  ...rule,
  enabled: rule.enabled !== false,
  action_config: rule.action_config && typeof rule.action_config === 'object' ? rule.action_config : {},
  priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 100,
})

function QuickReplyRules() {
  const { notify } = useApp()
  const [rules, setRules] = useState([])
  const [runs, setRuns] = useState([])
  const [allowedActions, setAllowedActions] = useState(Object.keys(QUICK_REPLY_ACTIONS))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runsError, setRunsError] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const [ruleOutcome, runOutcome] = await Promise.allSettled([
        loadWhatsappQuickReplyRules(),
        loadWhatsappQuickReplyRuns({ limit: 20 }),
      ])
      if (ruleOutcome.status === 'rejected') throw ruleOutcome.reason
      const ruleResult = ruleOutcome.value
      setRules((ruleResult.rules || []).map(normalizeQuickReplyRule))
      setRuns(runOutcome.status === 'fulfilled' && Array.isArray(runOutcome.value.runs) ? runOutcome.value.runs : [])
      setRunsError(runOutcome.status === 'rejected' ? 'Recent trigger history is temporarily unavailable.' : '')
      const available = (ruleResult.allowed_actions || []).map((item) => String(item?.key || item)).filter(Boolean)
      if (available.length) setAllowedActions(available)
      setError('')
    } catch (requestError) {
      const message = requestError?.message || ''
      setError(/not found|unknown route|404/i.test(message)
        ? 'Quick reply controls will appear after the matching backend update is deployed.'
        : message || 'Quick reply rules could not be loaded')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const patchDraft = (fields) => setDraft((current) => ({ ...current, ...fields }))
  const patchConfig = (fields) => setDraft((current) => ({
    ...current,
    action_config: { ...current.action_config, ...fields },
  }))

  const save = async () => {
    if (!draft?.name.trim() || !draft?.reply_key.trim()) {
      notify('Add a rule name and the exact quick-reply ID or title', true)
      return
    }
    setBusy('save')
    try {
      await saveWhatsappQuickReplyRule({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        enabled: draft.enabled !== false,
        source_template_key: draft.source_template_key.trim() || null,
        reply_key: draft.reply_key.trim(),
        action_type: draft.action_type,
        action_config: draft.action_config,
        priority: Number(draft.priority) || 100,
      })
      setDraft(null)
      await refresh()
      notify('Quick reply trigger saved')
    } catch (requestError) {
      notify(requestError.message || 'Could not save quick reply trigger', true)
    } finally {
      setBusy('')
    }
  }

  const toggle = async (rule) => {
    setBusy(rule.id)
    try {
      await saveWhatsappQuickReplyRule({ ...rule, enabled: !rule.enabled })
      await refresh()
    } catch (requestError) {
      notify(requestError.message || 'Could not update quick reply trigger', true)
    } finally {
      setBusy('')
    }
  }

  const remove = async (rule) => {
    if (!window.confirm(`Delete “${rule.name}”?\n\nFuture replies will no longer run this action.`)) return
    setBusy(rule.id)
    try {
      await deleteWhatsappQuickReplyRule(rule.id)
      if (draft?.id === rule.id) setDraft(null)
      await refresh()
      notify('Quick reply trigger deleted')
    } catch (requestError) {
      notify(requestError.message || 'Could not delete quick reply trigger', true)
    } finally {
      setBusy('')
    }
  }

  const configFields = draft && (() => {
    const config = draft.action_config
    if (draft.action_type === 'notify_assignee') return (
      <>
        <Field label="Notification title (optional)" value={config.title || ''} onChange={(title) => patchConfig({ title })} />
        <Field label="Notification text (optional)" value={config.body || ''} onChange={(body) => patchConfig({ body })} />
      </>
    )
    if (draft.action_type === 'create_followup_task') return (
      <>
        <Field label="Task title" value={config.title || ''} onChange={(title) => patchConfig({ title })} />
        <Field label="Task detail (optional)" value={config.detail || ''} onChange={(detail) => patchConfig({ detail })} />
        <div className="field"><label>Task priority</label><select value={config.priority || 'normal'} onChange={(event) => patchConfig({ priority: event.target.value })}>
          {['low', 'normal', 'high', 'urgent'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></div>
      </>
    )
    if (draft.action_type === 'send_session_text') return (
      <div className="field quick-rule-wide"><label>Reply text</label><textarea rows={3} value={config.text || ''} onChange={(event) => patchConfig({ text: event.target.value })} placeholder="Sent only if Meta's 24-hour window is open" /></div>
    )
    return (
      <>
        <Field label="Approved template key" value={config.template_key || ''} onChange={(template_key) => patchConfig({ template_key })} />
        <Field label="Language" value={config.language || 'en_US'} onChange={(language) => patchConfig({ language })} />
        <div className="field quick-rule-wide"><label>Parameters (one per line)</label><textarea rows={3}
          value={Array.isArray(config.params) ? config.params.join('\n') : ''}
          onChange={(event) => patchConfig({ params: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })}
          placeholder="Optional static parameters in Meta order" /></div>
      </>
    )
  })()

  return (
    <div className="quick-rules">
      <div className="quick-rules-head">
        <div>
          <strong>Quick reply triggers</strong>
          <span>Match a Meta button ID or title and run a controlled CRM action. STOP is always enforced first and cannot be overridden.</span>
        </div>
        <button className="btn sm" onClick={() => setDraft(newQuickReplyRule())} disabled={Boolean(draft) || loading}>Add trigger</button>
      </div>
      {loading && <p className="faint quick-rules-note">Loading quick reply triggers…</p>}
      {!loading && error && <p className="quick-rules-error">{error}</p>}
      {!loading && !error && rules.length === 0 && !draft && <p className="faint quick-rules-note">No configurable triggers yet. STOP protection is already active.</p>}
      {!error && rules.map((rule) => (
        <div className="quick-rule-row" key={rule.id}>
          <div>
            <strong>{rule.name}</strong>
            <span><code>{rule.reply_key}</code>{rule.source_template_key ? ` · ${rule.source_template_key}` : ' · any template'} · {QUICK_REPLY_ACTIONS[rule.action_type] || rule.action_type}</span>
            <small>{Number(rule.match_count || 0)} match{Number(rule.match_count || 0) === 1 ? '' : 'es'}{rule.last_triggered_at ? ` · last ${healthTime(rule.last_triggered_at)}` : ''}{rule.last_error ? ` · ${rule.last_error}` : ''}</small>
          </div>
          <div className="quick-rule-actions">
            <button type="button" className="switch" role="switch" aria-checked={rule.enabled} aria-label={`Toggle ${rule.name}`} disabled={busy === rule.id} onClick={() => toggle(rule)} />
            <button className="btn ghost sm" disabled={Boolean(busy)} onClick={() => setDraft(normalizeQuickReplyRule(rule))}>Edit</button>
            <button className="btn danger sm" disabled={Boolean(busy)} onClick={() => remove(rule)}>Delete</button>
          </div>
        </div>
      ))}
      {draft && (
        <div className="quick-rule-editor">
          <div className="grid2">
            <Field label="Rule name" value={draft.name} onChange={(name) => patchDraft({ name })} placeholder="Request a callback" />
            <Field label="Quick reply ID or title" value={draft.reply_key} onChange={(reply_key) => patchDraft({ reply_key })} placeholder="please_call_me" />
            <Field label="Source template key (optional)" value={draft.source_template_key} onChange={(source_template_key) => patchDraft({ source_template_key })} placeholder="followup_nudge_v1" />
            <div className="field"><label>Action</label><select value={draft.action_type} onChange={(event) => patchDraft({ action_type: event.target.value, action_config: {} })}>
              {allowedActions.map((action) => <option key={action} value={action}>{QUICK_REPLY_ACTIONS[action] || action.replaceAll('_', ' ')}</option>)}
            </select></div>
            <Field label="Priority" type="number" min="1" max="1000" value={String(draft.priority)} onChange={(priority) => patchDraft({ priority })} />
            {configFields}
          </div>
          <div className="save-row">
            <button className="btn ghost sm" onClick={() => setDraft(null)} disabled={busy === 'save'}>Cancel</button>
            <button className="btn primary sm" onClick={save} disabled={busy === 'save'}><Check /> {busy === 'save' ? 'Saving…' : 'Save trigger'}</button>
          </div>
        </div>
      )}
      {!error && runs.length > 0 && (
        <div className="quick-runs">
          <strong>Recent trigger runs</strong>
          {runs.slice(0, 8).map((run, index) => (
            <div key={run.id || `${run.created_at || 'run'}-${index}`}>
              <span>{run.rule_name || run.name || run.reply_key || run.action_type || 'Quick reply'}</span>
              <span className={`pill ${run.status === 'failed' ? 'danger' : ['completed', 'succeeded', 'processed'].includes(run.status) ? 'success' : 'warning'}`}><span className="dot" />{String(run.status || 'queued').replaceAll('_', ' ')}</span>
              <time>{healthTime(run.completed_at || run.created_at || run.started_at)}</time>
            </div>
          ))}
        </div>
      )}
      {!error && runsError && <p className="faint quick-rules-note">{runsError}</p>}
    </div>
  )
}

const readWhatsAppHealth = (health) => {
  const features = health?.features || health || {}
  const raw = features.whatsapp ?? health?.whatsapp
  const whatsapp = raw && typeof raw === 'object' ? raw : {}
  const webhook = whatsapp.webhook || health?.webhooks?.whatsapp || health?.whatsapp_webhook || {}
  const metaWebhook = whatsapp.meta_webhook || {}
  const templates = whatsapp.templates || health?.whatsapp_templates || {}
  const queue = whatsapp.queue || health?.queue || features.queue || {}
  const dlq = whatsapp.dlq || health?.dlq || queue.dlq || {}
  const provider = String(whatsapp.provider || '').toLowerCase()
  const active = provider === 'meta'
  const enabled = typeof raw === 'boolean' ? raw : whatsapp.enabled === true
  const configured = typeof raw === 'boolean'
    ? Boolean(raw && (!provider || active))
    : Boolean(whatsapp.meta_configured ?? (active && whatsapp.configured))
  const templateSyncConfigured = Boolean(whatsapp.template_sync_configured ?? configured)
  const webhookSecured = Boolean(
    whatsapp.meta_webhook_secured
    ?? metaWebhook.secured
    ?? (active ? (whatsapp.webhook_secured ?? webhook.secured ?? webhook.configured) : false),
  )
  const webhookReady = Boolean(
    metaWebhook.healthy
    ?? (active ? (webhook.healthy ?? webhook.verified ?? whatsapp.webhook_healthy ?? whatsapp.webhook_secured) : false),
  )
  const webhookVerified = Boolean(
    metaWebhook.verified
    ?? metaWebhook.healthy
    ?? (active ? (webhook.verified ?? webhook.healthy) : false),
  )
  const approvedTemplates = templates.approved_count ?? templates.approved
    ?? whatsapp.approved_templates ?? whatsapp.approved_template_count
  const requiredTemplates = templates.required_count ?? templates.required ?? whatsapp.required_template_count
  return {
    provider,
    otpProvider: String(whatsapp.otp_provider || '').toLowerCase(),
    active,
    enabled,
    configured,
    templateSyncConfigured,
    webhookSecured,
    webhookReady,
    webhookVerified,
    webhookStale: Boolean(metaWebhook.stale ?? (active ? webhook.stale : false)),
    lastEventAt: metaWebhook.last_event_at || webhook.last_event_at || whatsapp.last_event_at || whatsapp.last_webhook_event_at || health?.last_whatsapp_event_at || null,
    lastProcessedAt: metaWebhook.last_processed_at || webhook.last_processed_at || whatsapp.last_processed_at || null,
    webhookPendingCount: metaWebhook.pending_count ?? webhook.pending_count ?? whatsapp.webhook_pending,
    webhookFailedCount: metaWebhook.failed_count ?? webhook.failed_count ?? whatsapp.webhook_failed,
    templatesReady: templates.ready ?? whatsapp.templates_ready,
    approvedTemplates,
    requiredTemplates,
    templateIssues: templates.issues || whatsapp.template_issues || [],
    queueReady: queue.ready ?? queue.configured ?? queue.enabled ?? whatsapp.queue_configured,
    pendingCount: queue.pending_count ?? whatsapp.pending_outbox,
    reviewCount: queue.review_required_count ?? whatsapp.review_required,
    backlogCount: queue.backlog_count ?? queue.depth ?? null,
    dlqCount: dlq.backlog_count ?? dlq.pending_count ?? dlq.pending ?? dlq.count ?? queue.dlq_count,
  }
}

const LEAD_COLOURS = ['success', 'warning', 'danger', 'info', 'neutral']

// Admin-managed lead types + Meta form→type map. DB-driven so new categories/forms
// need no code change. Reads open to staff; writes require a manager (checked by RLS).
function LeadTypesForms() {
  const { notify, setLeadTypes } = useApp()
  const [types, setTypes] = useState(null)   // null = loading
  const [forms, setForms] = useState(null)
  const [newType, setNewType] = useState({ key: '', label: '', color: 'neutral', default_source: '' })
  const [newForm, setNewForm] = useState({ form_id: '', form_name: '', lead_type: '', platform: 'meta' })

  useEffect(() => {
    loadLeadTypes().then(setTypes).catch(() => setTypes([]))
    loadLeadForms().then(setForms).catch(() => setForms([]))
  }, [])

  const patchType = (key, patch) =>
    setTypes((ts) => ts.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const patchForm = (id, patch) =>
    setForms((fs) => fs.map((x) => (x.form_id === id ? { ...x, ...patch } : x)))

  // refresh local list AND push to app context so the rest of the app reflects edits
  const refreshTypes = async () => {
    const rows = await loadLeadTypes()
    setTypes(rows)
    setLeadTypes(rows)
  }

  const saveType = async (t) => {
    try {
      await upsertLeadType({
        key: t.key, label: t.label, color: t.color,
        default_source: t.default_source || '', sort: t.sort, active: t.active,
      })
      await refreshTypes()
      notify('Record category saved')
      return true
    } catch (e) { notify(e.message || 'Could not save record category', true); return false }
  }
  const removeType = async (key) => {
    try {
      await deleteLeadType(key)
      await refreshTypes()
      notify('Record category deleted')
    } catch (e) { notify(e.message || 'Could not delete record category') }
  }
  const addType = async () => {
    const key = newType.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!key) { notify('Enter a key for the new type'); return }
    const saved = await saveType({
      key,
      label: newType.label.trim() || key,
      color: newType.color,
      default_source: newType.default_source.trim(),
      sort: (types?.length || 0) + 1,
      active: true,
    })
    if (saved) setNewType({ key: '', label: '', color: 'neutral', default_source: '' })
  }

  const saveForm = async (f) => {
    try {
      await upsertLeadForm({
        form_id: f.form_id, form_name: f.form_name,
        lead_type: f.lead_type, platform: f.platform || 'meta', active: f.active,
      })
      setForms(await loadLeadForms())
      notify('Form mapping saved')
      return true
    } catch (e) { notify(e.message || 'Could not save form', true); return false }
  }
  const removeForm = async (id) => {
    try {
      await deleteLeadForm(id)
      setForms(await loadLeadForms())
      notify('Form mapping deleted')
    } catch (e) { notify(e.message || 'Could not delete form') }
  }
  const addForm = async () => {
    const form_id = newForm.form_id.trim()
    if (!form_id) { notify('Enter the Meta form ID'); return }
    const saved = await saveForm({
      form_id,
      form_name: newForm.form_name.trim() || form_id,
      lead_type: newForm.lead_type || (types?.[0]?.key || 'general'),
      platform: newForm.platform.trim() || 'meta',
      active: true,
    })
    if (saved) setNewForm({ form_id: '', form_name: '', lead_type: '', platform: 'meta' })
  }

  const typeOptions = types || []

  return (
    <div className="panel">
      <div className="panel-h">Record categories &amp; forms</div>

      {/* Lead types */}
      <p className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
        Categories new records are sorted into. Add one and it shows everywhere — no code change.
      </p>
      {types == null ? (
        <p className="faint" style={{ fontSize: 12 }}>Loading…</p>
      ) : (
        <>
          {types.map((t) => (
            <div className="line-row" key={t.key}>
              <div className="lr-main" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input value={t.label || ''} onChange={(e) => patchType(t.key, { label: e.target.value })}
                  placeholder="Label" style={{ maxWidth: 160 }} />
                <span className="lr-d">{t.key}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select value={t.color || 'neutral'} onChange={(e) => patchType(t.key, { color: e.target.value })}>
                  {LEAD_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="switch" role="switch" aria-checked={!!t.active}
                  aria-label={'Toggle ' + (t.label || t.key)}
                  onClick={() => saveType({ ...t, active: !t.active })} />
                <button className="btn sm" onClick={() => saveType(t)}><Check /> Save</button>
                <button className="btn sm" onClick={() => removeType(t.key)}>Delete</button>
              </div>
            </div>
          ))}
          <div className="line-row">
            <div className="lr-main" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input value={newType.key} onChange={(e) => setNewType((n) => ({ ...n, key: e.target.value }))}
                placeholder="key (slug)" style={{ maxWidth: 130 }} />
              <input value={newType.label} onChange={(e) => setNewType((n) => ({ ...n, label: e.target.value }))}
                placeholder="Label" style={{ maxWidth: 150 }} />
              <input value={newType.default_source} onChange={(e) => setNewType((n) => ({ ...n, default_source: e.target.value }))}
                placeholder="default source (optional)" style={{ maxWidth: 170 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select value={newType.color} onChange={(e) => setNewType((n) => ({ ...n, color: e.target.value }))}>
                {LEAD_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="btn primary sm" onClick={addType}><Check /> Add category</button>
            </div>
          </div>
        </>
      )}

      {/* Meta form → lead type map */}
      <p className="faint" style={{ fontSize: 12, margin: '16px 0 6px' }}>
        Map a Meta form to a record category. Automatic intake requires Meta webhooks configured on your backend.
      </p>
      {forms == null ? (
        <p className="faint" style={{ fontSize: 12 }}>Loading…</p>
      ) : (
        <>
          {forms.map((f) => (
            <div className="line-row" key={f.form_id}>
              <div className="lr-main" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input value={f.form_id || ''} onChange={(e) => patchForm(f.form_id, { form_id: e.target.value })}
                  placeholder="Form ID" style={{ maxWidth: 140 }} />
                <input value={f.form_name || ''} onChange={(e) => patchForm(f.form_id, { form_name: e.target.value })}
                  placeholder="Form name" style={{ maxWidth: 160 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select value={f.lead_type || ''} onChange={(e) => patchForm(f.form_id, { lead_type: e.target.value })}>
                  {typeOptions.map((t) => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
                </select>
                <input value={f.platform || 'meta'} onChange={(e) => patchForm(f.form_id, { platform: e.target.value })}
                  placeholder="platform" style={{ maxWidth: 90 }} />
                <button className="switch" role="switch" aria-checked={!!f.active}
                  aria-label={'Toggle ' + (f.form_name || f.form_id)}
                  onClick={() => saveForm({ ...f, active: !f.active })} />
                <button className="btn sm" onClick={() => saveForm(f)}><Check /> Save</button>
                <button className="btn sm" onClick={() => removeForm(f.form_id)}>Delete</button>
              </div>
            </div>
          ))}
          <div className="line-row">
            <div className="lr-main" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input value={newForm.form_id} onChange={(e) => setNewForm((n) => ({ ...n, form_id: e.target.value }))}
                placeholder="Form ID" style={{ maxWidth: 140 }} />
              <input value={newForm.form_name} onChange={(e) => setNewForm((n) => ({ ...n, form_name: e.target.value }))}
                placeholder="Form name" style={{ maxWidth: 160 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select value={newForm.lead_type} onChange={(e) => setNewForm((n) => ({ ...n, lead_type: e.target.value }))}>
                <option value="">Record category…</option>
                {typeOptions.map((t) => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
              </select>
              <input value={newForm.platform} onChange={(e) => setNewForm((n) => ({ ...n, platform: e.target.value }))}
                placeholder="platform" style={{ maxWidth: 90 }} />
              <button className="btn primary sm" onClick={addForm}><Check /> Add form</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Settings() {
  const { me, can, notify, workspace, profiles, saas, chooseWorkspace } = useApp()
  const editable = can('settings.edit')
  const viewSettings = can('settings.view')
  const settingsId = useId()
  const [activeTab, setActiveTab] = useState('overview')
  const [visitedTabs, setVisitedTabs] = useState(['overview'])
  const [showPw, setShowPw] = useState(false)
  const [health, setHealth] = useState(undefined)   // undefined = checking, null = unavailable
  const [refreshingHealth, setRefreshingHealth] = useState(false)
  const [syncingTemplates, setSyncingTemplates] = useState(false)
  const refreshHealth = async (showProgress = false) => {
    if (!viewSettings) return
    if (showProgress) setRefreshingHealth(true)
    try { setHealth(await loadHealth()) } catch { setHealth(null) }
    finally { if (showProgress) setRefreshingHealth(false) }
  }
  useEffect(() => {
    if (!viewSettings) { setHealth(null); return undefined }
    let current = true
    const check = async () => {
      try { const result = await loadHealth(); if (current) setHealth(result) }
      catch { if (current) setHealth(null) }
    }
    setHealth(undefined)
    check()
    const timer = window.setInterval(check, 60_000)
    return () => { current = false; window.clearInterval(timer) }
  }, [viewSettings, me?.id])
  const checking = health === undefined
  const features = health?.features || health || {}
  const whatsappHealth = readWhatsAppHealth(health)
  const emailHealth = typeof features.email === 'object' ? features.email.configured ?? features.email.enabled : features.email
  const aiHealth = typeof features.ai === 'object' ? (features.ai.provider || (features.ai.enabled ? 'active' : 'none')) : features.ai

  const intakeSources = SOURCE_CHANNELS.filter((s) => s.v)
  const tabs = [
    { id: 'overview', label: 'Overview', icon: <FileText /> },
    ...(can('settings.view') ? [
      { id: 'workspace', label: 'Workspace', icon: <SettingsIcon /> },
      { id: 'connections', label: 'Connections', icon: <Chat /> },
    ] : []),
    ...(can('team.view') ? [{ id: 'team', label: 'Team & access', icon: <Users width={16} height={16} /> }] : []),
    ...(can('intake.manage') || can('leadtypes.manage') ? [{ id: 'intake', label: 'Intake', icon: <Mail /> }] : []),
    { id: 'appearance', label: 'Appearance', icon: <Sun /> },
    { id: 'account', label: 'Account', icon: <Lock /> },
  ]
  const selectedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : 'overview'
  const selectTab = (id) => {
    setActiveTab(id)
    setVisitedTabs((current) => current.includes(id) ? current : [...current, id])
  }
  const tabKeyDown = (event, id) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    let next
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = tabs[(index + 1) % tabs.length]
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = tabs[(index - 1 + tabs.length) % tabs.length]
    else if (event.key === 'Home') next = tabs[0]
    else if (event.key === 'End') next = tabs[tabs.length - 1]
    if (!next) return
    event.preventDefault()
    selectTab(next.id)
    document.getElementById(`${settingsId}-tab-${next.id}`)?.focus()
  }
  const section = (id, children) => (
    <section key={id} className="settings-section" id={`${settingsId}-panel-${id}`} role="tabpanel"
      aria-labelledby={`${settingsId}-tab-${id}`} hidden={selectedTab !== id} tabIndex={0}>{visitedTabs.includes(id) ? children : null}</section>
  )
  const activeMembers = (profiles || []).filter((person) => person.active).length

  const syncMetaTemplates = async () => {
    if (syncingTemplates) return
    setSyncingTemplates(true)
    try {
      const result = await syncWhatsappTemplates()
      const count = result.synced_count ?? result.synced ?? result.count
      notify(count == null ? 'Meta templates synced' : `${count} Meta template${Number(count) === 1 ? '' : 's'} synced`)
      await refreshHealth()
    } catch (error) {
      notify(error.message || 'Template sync failed', true)
    } finally {
      setSyncingTemplates(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="page-head settings-page-head">
        <div>
          <span className="ttl">Settings</span>
          <p className="sub">Your business, connections, people, and preferences.</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-rail">
          <div className="settings-workspace-name"><strong>{workspace?.name || 'Workspace CRM'}</strong>
            <span>{saas ? 'Shared workspace' : hasConfig ? 'Business workspace' : 'Demo workspace'}</span></div>
          <div className="settings-nav" role="tablist" aria-label="Settings sections">
            {tabs.map((tab) => <button key={tab.id} id={`${settingsId}-tab-${tab.id}`} role="tab" type="button"
              aria-selected={selectedTab === tab.id} aria-controls={`${settingsId}-panel-${tab.id}`} tabIndex={selectedTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)} onKeyDown={(event) => tabKeyDown(event, tab.id)}>{tab.icon}<span>{tab.label}</span></button>)}
          </div>
          {saas && chooseWorkspace && <button className="btn ghost sm settings-switch-workspace" onClick={() => chooseWorkspace()}>Switch workspace</button>}
        </aside>
        <div className="settings-content">
      {section('overview', <>
        <div className="settings-intro">
          <h2>Make this workspace yours</h2>
          <p>Set the details your team works with, connect your tools, and choose who can access the workspace.</p>
        </div>
        <div className="settings-checklist" aria-label="Workspace setup overview">
          {can('settings.view') && <>
            <button type="button" className="settings-checklist-row" onClick={() => selectTab('workspace')}>
              <span className={`settings-check-icon ${workspace?.setupComplete ? 'complete' : ''}`}>{workspace?.setupComplete ? <Check /> : <SettingsIcon />}</span>
              <span className="settings-check-copy"><strong>Business profile & workflow</strong><span>Your name, terminology, pipeline stages, and custom fields.</span></span>
              <span className="settings-check-action">{workspace?.setupComplete ? 'Review' : 'Set up'}</span>
            </button>
            <button type="button" className="settings-checklist-row" onClick={() => selectTab('connections')}>
              <span className={`settings-check-icon ${hasConfig ? 'complete' : ''}`}>{hasConfig ? <Check /> : <Chat />}</span>
              <span className="settings-check-copy"><strong>{hasConfig ? 'Database configured' : 'Connect your database'}</strong><span>{hasConfig ? 'Review your database and messaging connections.' : 'Save business records beyond this demo session.'}</span></span>
              <span className="settings-check-action">{hasConfig ? 'Review' : 'Connect'}</span>
            </button>
          </>}
          {can('team.view') && <button type="button" className="settings-checklist-row" onClick={() => selectTab('team')}>
            <span className="settings-check-icon"><Users width={18} height={18} /></span>
            <span className="settings-check-copy"><strong>People & permissions</strong><span>{hasConfig ? `${activeMembers} active ${activeMembers === 1 ? 'member' : 'members'} in this workspace.` : 'Explore team roles in the demo. Connect a database to add your team.'}</span></span>
            <span className="settings-check-action">Manage</span>
          </button>}
          <button type="button" className="settings-checklist-row" onClick={() => selectTab('appearance')}>
            <span className="settings-check-icon"><Sun /></span>
            <span className="settings-check-copy"><strong>Appearance</strong><span>Choose your colors and display mode. Make this browser feel like yours.</span></span>
            <span className="settings-check-action">Choose</span>
          </button>
          <button type="button" className="settings-checklist-row" onClick={() => selectTab('account')}>
            <span className="settings-check-icon"><Lock /></span>
            <span className="settings-check-copy"><strong>Your account</strong><span>{me?.email || 'Review your sign-in details and workspace role.'}</span></span>
            <span className="settings-check-action">View</span>
          </button>
        </div>
        <div className="settings-context-note"><Shield /><p>{hasConfig
          ? saas ? 'Your membership controls access to this workspace. Business settings and team access are managed separately from your personal account.' : 'Your business records use the configured database. Review connection status before relying on email or WhatsApp delivery.'
          : 'You are exploring the demo. Records reset when the page reloads; workspace preferences stay in this browser.'}</p></div>
      </>)}

      {can('settings.view') && section('workspace', <>
      <div className="settings-section-heading"><h2>Workspace</h2><p>Adapt the CRM to the way your business works.</p></div>
      <div className="panel">
        <div className="panel-h">Business workspace</div>
        <WorkspaceProfileForm editable={editable} />
      </div>
      <div className="panel settings-privacy">
        <div className="panel-h"><span><Shield /> Data &amp; privacy</span></div>
        <ul>{PRIVACY.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className="faint">{hasConfig ? 'Business records are stored in the database configured for this workspace.' : 'Connect a database before adding records that need to be kept.'}</p>
      </div>
      </>)}

      {can('settings.view') && section('connections', <>
      <div className="settings-section-heading"><h2>Connections</h2><p>Manage the database and services behind your workspace.</p></div>
      <ConnectionSettings editable={me?.role === 'admin'} />
      <div className="panel">
        <div className="panel-h">Channels &amp; AI</div>
        {(!hasConfig || health?.integrationsConnected === false) && <p className="faint" style={{ fontSize: 12, marginBottom: 14 }}>Connect an integration service and your own provider accounts to enable messaging, automatic intake and AI.</p>}
        <ChannelRow
          icon={<Chat />}
          title="WhatsApp · Meta Cloud API"
          desc={whatsappHealth.active && whatsappHealth.enabled && whatsappHealth.configured
            ? 'Connected to your workspace’s Meta Cloud API.'
            : whatsappHealth.active && whatsappHealth.configured
              ? 'Official Meta Cloud API is configured but sending is paused.'
              : !whatsappHealth.active && whatsappHealth.templateSyncConfigured
                ? 'Meta is configured, but a legacy provider is still active. Complete the cutover before sending.'
                : 'Connect your own Meta business account and configure its webhook on your backend.'}
          right={<>
            {checking ? <span className="faint" style={{ fontSize: 12 }}>Checking…</span>
              : health === null ? <ChStatus tone="neutral">Status unavailable</ChStatus>
              : whatsappHealth.active && whatsappHealth.enabled && whatsappHealth.configured && whatsappHealth.webhookReady ? <ChStatus tone="success">Connected</ChStatus>
                : whatsappHealth.active && !whatsappHealth.enabled && whatsappHealth.configured ? <ChStatus tone="warning">Paused</ChStatus>
                : !whatsappHealth.active && whatsappHealth.templateSyncConfigured ? <ChStatus tone="warning">Cutover needed</ChStatus>
                : whatsappHealth.configured ? <ChStatus tone="warning">Needs attention</ChStatus>
                  : <ChStatus tone="neutral">Not connected</ChStatus>}
            {editable && <button className="btn ghost sm" onClick={syncMetaTemplates} disabled={syncingTemplates || !whatsappHealth.templateSyncConfigured}>
              {syncingTemplates ? 'Syncing…' : 'Sync templates'}
            </button>}
            <button className="btn ghost sm" onClick={() => refreshHealth(true)} disabled={refreshingHealth}>
              {refreshingHealth ? 'Refreshing…' : 'Refresh status'}
            </button>
          </>}
        />
        {!checking && health && (whatsappHealth.configured || whatsappHealth.templateSyncConfigured) && <WhatsAppHealthDetails info={whatsappHealth} />}
        {editable && hasConfig && whatsappHealth.configured && <QuickReplyRules />}
        <ChannelRow
          icon={<Mail />}
          title="Email"
          desc="Use your own email provider and verified sending domain for welcome notes and reminders."
          right={checking ? <span className="faint" style={{ fontSize: 12 }}>Checking…</span>
            : health === null ? <ChStatus tone="neutral">Status unavailable</ChStatus>
            : emailHealth ? <ChStatus tone="success">Connected</ChStatus>
            : <ChStatus tone="neutral">Not connected</ChStatus>}
        />
        <ChannelRow
          icon={<Sparkle />}
          title="AI assistant"
          desc="Connect an AI provider on your backend to enable record scoring, summaries and assistance."
          right={checking ? <span className="faint" style={{ fontSize: 12 }}>Checking…</span>
            : health === null ? <ChStatus tone="neutral">Status unavailable</ChStatus>
            : (aiHealth && aiHealth !== 'none')
              ? <ChStatus tone="success">Connected</ChStatus>
              : <ChStatus tone="neutral">Not connected</ChStatus>}
        />
      </div>
      </>)}

      {can('team.view') && section('team', saas ? <SaasTeam /> : <Team />)}

      {(can('intake.manage') || can('leadtypes.manage')) && section('intake', <>
      <div className="settings-section-heading"><h2>Intake</h2><p>Organize where new records come from and how they are categorized.</p></div>
      {can('intake.manage') && (
      <div className="panel">
        <div className="panel-h">Record source categories</div>
        <p className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Use these categories when adding records. Automatic intake is managed by the integrations on your backend.</p>
        {intakeSources.map((s) => {
          return (
            <div className="line-row" key={s.v}>
              <div className="lr-main">
                <div className="lr-t">{s.l}</div>
              </div>
              <span className="pill neutral">Available</span>
            </div>
          )
        })}
      </div>
      )}

      {/* Lead types & forms — admins */}
      {can('leadtypes.manage') && <LeadTypesForms />}
      </>)}

      {section('appearance', <AppearanceSettings />)}

      {/* Your account — everyone */}
      {section('account', <>
      <div className="settings-section-heading"><h2>Account</h2><p>Your sign-in details and role in this workspace.</p></div>
      <div className="panel">
        <div className="panel-h">Your account</div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between">
            <span className="faint" style={{ fontSize: 12 }}>Name</span>
            <span style={{ fontWeight: 600 }}>{me.name}</span>
          </div>
          <div className="row-between">
            <span className="faint" style={{ fontSize: 12 }}>Email</span>
            <span className="muted">{me.email || '—'}</span>
          </div>
          <div className="row-between">
            <span className="faint" style={{ fontSize: 12 }}>Role</span>
            <span className={'pill ' + rolePill(me.role)}><span className="dot" />{roleLabel(me.role)}</span>
          </div>
        </div>
        {hasConfig ? (
          <div className="save-row">
            <button className="btn sm" onClick={() => setShowPw(true)}><Lock /> Change password</button>
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>Password changes are available once you’re signed in to a real account.</p>
        )}
      </div>
      </>)}
        </div>
      </div>
      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
    </div>
  )
}
