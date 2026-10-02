import { supabase, hasConfig, isSaas, activeWorkspaceId, workerUrl, tenantHeaders } from './supabase'
import { tenantTable } from './tenant.js'
import * as demo from './demo'
import { TEAM_PROFILE_FIELDS, accountActionPayload } from './teamAccounts'
import { demoWhatsappTemplates, normalizeWhatsappTemplate } from './wa'
import { readLocalWorkspace, saveLocalWorkspace } from './workspace'
import {
  normalizeWhatsAppPhone,
  safeWhatsappCancellationDetail,
  WHATSAPP_CONSENT_CONFIRMATION,
} from './whatsappSafety'

// Connections are opt-in. Demo mode never reads or writes an external backend.
const MOCK = !hasConfig
const crmTable = (table) => isSaas ? tenantTable(supabase, table, activeWorkspaceId) : supabase.from(table)
const demoWhatsappSuppressions = new Map()

// ── small helpers (ported from the current CRM) ─────────────────────────────
export const clampScore = (v) => {
  if (v === '' || v == null) return ''
  const n = Math.round(Number(v))
  if (isNaN(n)) return ''
  return String(Math.min(100, Math.max(0, n)))
}
export const initials = (n) => {
  if (!n) return '?'
  const p = n.trim().split(/\s+/)
  return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase()
}
// Imported leads keep their original owner as text in remarks
// ("[Imported — was assigned to: X]"); pull that name out when present.
export const importedAssignee = (remarks) => {
  const m = /assigned to:\s*([^\]\n]+)/i.exec(remarks || '')
  return m ? m[1].trim() : ''
}
export const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export const isToday = (s) => {
  if (!s) return false
  const t = new Date(), d = new Date(s)
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}
export const isOverdue = (s) => {
  if (!s) return false
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const d = new Date(s); d.setHours(0, 0, 0, 0)
  return d < t
}

// ── lead <-> row mapping (camelCase app ⇄ snake_case db) ────────────────────
const FIELD_MAP = {
  name: 'name', phone: 'phone', email: 'email', dob: 'dob',
  company: 'company', jobTitle: 'job_title', city: 'city', interest: 'interest',
  budget: 'budget', currency: 'currency', website: 'website', expectedCloseDate: 'expected_close_date', customFields: 'custom_fields',
  source: 'source', sourceChannel: 'source_channel',
  qualStatus: 'qual_status', journeyStatus: 'journey_status',
  score: 'score', aiScore: 'ai_score', aiSummary: 'ai_summary',
  followupDate: 'followup_date', followupTime: 'followup_time',
  assignedTo: 'assigned_to', priority: 'priority', remarks: 'remarks', manualRank: 'manual_rank',
  lastActivity: 'last_activity', createdAt: 'created_at', createdBy: 'created_by',
  consentWhatsapp: 'consent_whatsapp', consentEmail: 'consent_email',
  // multi-channel: lead type + ad/campaign attribution
  leadType: 'lead_type', platform: 'platform',
  campaignName: 'campaign_name', campaignId: 'campaign_id',
  adsetName: 'adset_name', adsetId: 'adset_id', adName: 'ad_name', adId: 'ad_id',
  formName: 'form_name', formId: 'form_id',
  utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign',
  lastContactedAt: 'last_contacted_at',
}
const DATE_FIELDS = new Set(['dob', 'followup_date', 'last_activity', 'expected_close_date', 'last_contacted_at'])

export function rowToLead(r) {
  const l = { id: r.id, createdAt: r.created_at || '' }
  for (const [cam, snk] of Object.entries(FIELD_MAP)) {
    let v = r[snk]
    if (v == null) v = (snk === 'score' || snk === 'ai_score') ? '' : ''
    l[cam] = (snk === 'score' || snk === 'ai_score') && v !== '' ? String(v) : v
  }
  l.manualRank = r.manual_rank == null ? null : Number(r.manual_rank)
  l.qualStatus = l.qualStatus || 'Not Yet Contacted'
  l.journeyStatus = l.journeyStatus || 'New Lead'
  l.budget = r.budget == null ? null : Number(r.budget)
  l.customFields = r.custom_fields && typeof r.custom_fields === 'object' && !Array.isArray(r.custom_fields) ? r.custom_fields : {}
  l.leadType = l.leadType || 'general'
  l.duplicateCount = r.duplicate_count == null ? 0 : Number(r.duplicate_count)
  l.meta = r.meta && typeof r.meta === 'object' ? r.meta : {}
  return l
}

export function fieldsToRow(fields) {
  const row = {}
  for (const [k, v] of Object.entries(fields)) {
    const snk = FIELD_MAP[k]
    if (!snk) continue
    if (snk === 'score' || snk === 'ai_score') row[snk] = v === '' || v == null ? null : Number(v)
    else if (snk === 'manual_rank' || snk === 'budget') {
      const n = v === '' || v == null ? null : Number(v)
      if (n !== null && (!Number.isFinite(n) || snk === 'budget' && n < 0)) throw new Error('Enter a valid non-negative budget.')
      row[snk] = n
    }
    else if (snk === 'custom_fields') {
      if (v !== null && v !== undefined && (typeof v !== 'object' || Array.isArray(v))) throw new Error('Custom fields must be a field/value object.')
      row[snk] = v || {}
    }
    else if (snk === 'assigned_to') row[snk] = v || null
    else if (snk === 'created_at') { if (v) row[snk] = v }   // never blank out the added-date
    else if (snk === 'created_by') { if (v) row[snk] = v }   // set once on insert; never overwrite
    else if (DATE_FIELDS.has(snk)) row[snk] = v || null
    else row[snk] = v
  }
  return row
}

// Optional integration gateway. Core CRM records use the standalone database;
// credentials, external sending, uploads and automation need a separate service.
async function workerWrite(path, payload) {
  if (MOCK || !WORKER_URL) throw new Error('This integration is not connected. Configure your own integration service in Settings before using it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}${path}`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.ok) {
    const error = new Error(out.error || `Request failed (${res.status})`)
    error.status = res.status
    error.code = out.code || out.state || ''
    error.payload = out
    throw error
  }
  return out
}

async function workerRequest(path, { method = 'GET', body } = {}) {
  if (MOCK || !WORKER_URL) throw new Error('This integration is not connected. Configure your own integration service in Settings before using it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}${path}`, {
    redirect: 'error',
    method,
    headers: {
      ...tenantHeaders(), authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.ok === false) throw new Error(out.error || `Request failed (${res.status})`)
  return out
}

// ── CRUD ────────────────────────────────────────────────────────────────────
// Every table below is protected by supabase/standalone.sql row-level security.
// Keyset pages avoid offset shifts when another person inserts a record.
const CRM_PAGE_SIZE = 500
async function readAllRows(table, configure = (query) => query) {
  const rows = []
  let after = null
  for (;;) {
    let query = configure(crmTable(table).select('*')).order('id', { ascending: true }).limit(CRM_PAGE_SIZE)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < CRM_PAGE_SIZE) return rows
    after = page[page.length - 1].id
  }
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user?.id) throw new Error('Sign in again to continue.')
  return data.user
}

async function checkedMutation(query, message = 'Record no longer exists or you do not have permission to change it.') {
  const { data, error } = await query.select().single()
  if (error) throw new Error(error.code === 'PGRST116' ? message : error.message)
  if (!data) throw new Error(message)
  return data
}

export async function loadWorkspaceSettings() {
  if (MOCK) return readLocalWorkspace()
  const { data, error } = await crmTable('workspace_settings').select('config').eq('id', 'default').maybeSingle()
  if (error) throw error
  return data?.config || {}
}

export async function saveWorkspaceSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Workspace settings must be an object.')
  if (MOCK) { saveLocalWorkspace(settings); return readLocalWorkspace() }
  const saved = await checkedMutation(crmTable('workspace_settings').upsert({ id: 'default', config: settings, updated_at: new Date().toISOString() }))
  return saved.config
}

export function sortLeadsByAddedDate(leads) {
  return [...(leads || [])].sort((a, b) => {
    const aTime = Date.parse(a?.createdAt || '')
    const bTime = Date.parse(b?.createdAt || '')
    const timeDiff = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
    return timeDiff || String(b?.id || '').localeCompare(String(a?.id || ''))
  })
}

export async function loadLeads() {
  if (MOCK) return demo.loadLeads()
  const rows = await readAllRows('leads', (query) => query.is('deleted_at', null))
  return sortLeadsByAddedDate(rows.map(rowToLead))
}

// Aggregate change token for focus/background refreshes, with the same staff gate.
export async function loadLeadsRevision() {
  if (MOCK) return ''
  const { data, error } = await supabase.rpc('crm_leads_revision')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const count = Number(row?.active_count ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('CRM returned an invalid lead revision.')
  return `${count}|${row?.latest_created_at || ''}|${row?.latest_updated_at || ''}`
}

// Export combines the same role-protected records used by the register.
export async function loadLeadExport() {
  if (MOCK) {
    const leads = await demo.loadLeads()
    return Promise.all(leads.map(async (lead) => ({
      ...lead,
      activities: await demo.loadActivities(lead.id),
    })))
  }

  const [leads, activities] = await Promise.all([loadLeads(), readAllRows('activities')])
  const byLead = new Map()
  for (const activity of activities) {
    if (!byLead.has(activity.lead_id)) byLead.set(activity.lead_id, [])
    byLead.get(activity.lead_id).push(activity)
  }
  return leads.map((lead) => ({ ...lead, activities: (byLead.get(lead.id) || []).sort((a, b) => new Date(b.at) - new Date(a.at)) }))
}

export async function loadLead(id) {
  if (MOCK) { const ls = await demo.loadLeads(); return ls.find((l) => l.id === id) || null }
  const { data, error } = await crmTable('leads').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw error
  return data ? rowToLead(data) : null
}

export async function insertLead(fields) {
  if (MOCK) return demo.insertLead(fields)
  const user = await requireUser()
  const row = await checkedMutation(crmTable('leads').insert({ ...fieldsToRow(fields), created_by: user.id }))
  return { ...rowToLead(row), welcomeQueued: false, welcomeStatus: 'not_configured' }
}

// Returning rows makes denied or missing updates visible to optimistic callers.
export async function updateLead(id, fields) {
  if (MOCK) return demo.updateLead(id, fields)
  const row = fieldsToRow(fields)
  delete row.created_by
  return rowToLead(await checkedMutation(crmTable('leads').update(row).eq('id', id).is('deleted_at', null)))
}

// soft delete — moves the lead to the Bin (sets deleted_at) instead of removing it
export async function deleteLead(id) {
  if (MOCK) return demo.deleteLead(id)
  await checkedMutation(crmTable('leads').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null))
}

// ── bin / trash ─────────────────────────────────────────────────────────────
export async function loadTrash() {
  if (MOCK) return demo.loadTrash()
  const rows = await readAllRows('leads', (query) => query.not('deleted_at', 'is', null))
  return rows.map((r) => ({ ...rowToLead(r), deletedAt: r.deleted_at }))
}
export async function restoreLead(id) {
  if (MOCK) return demo.restoreLead(id)
  await checkedMutation(crmTable('leads').update({ deleted_at: null }).eq('id', id).not('deleted_at', 'is', null))
}
export async function purgeLead(id) {
  if (MOCK) return demo.purgeLead(id)
  await checkedMutation(crmTable('leads').delete().eq('id', id).not('deleted_at', 'is', null))
}
export async function emptyTrash() {
  if (MOCK) return demo.emptyTrash()
  const trash = await loadTrash()
  for (const l of trash) await purgeLead(l.id)
}

// ── realtime ──────────────────────────────────────────────────────────────
// Focus and revision refreshes keep records current without requiring Realtime.
export function subscribeLeads(onChange) {
  void onChange
  return () => {}
}

// Optional Realtime publication; focus refresh is also supported.
export function subscribeAppointments(onChange) {
  if (MOCK) return () => {}
  // PostgreSQL Changes does not propagate the per-request workspace header.
  // Poll scoped reads in SaaS instead; never subscribe to an unscoped feed.
  if (isSaas) { const timer = setInterval(onChange, 20000); return () => clearInterval(timer) }
  const ch = supabase
    .channel('appts-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, onChange)
    .subscribe()
  return () => { try { supabase.removeChannel(ch) } catch { /* already gone */ } }
}

// ── activities (separate table now) ─────────────────────────────────────────
export async function loadActivities(leadId) {
  if (MOCK) return demo.loadActivities(leadId)
  const rows = await readAllRows('activities', (query) => query.eq('lead_id', leadId))
  return rows.sort((a, b) => new Date(b.at) - new Date(a.at))
}
export async function addActivity(leadId, { type, notes, at }) {
  if (MOCK) return demo.addActivity(leadId, { type, notes, at })
  const user = await requireUser()
  return checkedMutation(crmTable('activities').insert({ lead_id: leadId, type, notes, by: user.id, ...(at ? { at } : {}) }))
}
export async function deleteActivity(id) {
  if (MOCK) return demo.deleteActivity(id)
  await checkedMutation(crmTable('activities').delete().eq('id', id))
}

// ── appointments (separate table) ────────────────────────────────────────────
const rowToAppt = (r) => ({
  id: r.id, leadId: r.lead_id, datetime: r.datetime, type: r.type, status: r.status,
  source: r.source, createdBy: r.created_by, createdAt: r.created_at,
})
export async function loadAppointments(leadId) {
  if (MOCK) return demo.loadAppointments(leadId)
  const { data, error } = await crmTable('appointments').select('*').eq('lead_id', leadId).order('datetime', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToAppt)
}
// every non-cancelled appointment, for the Calendar (lead name resolved from leads in memory)
export async function loadUpcomingAppointments() {
  if (MOCK) return demo.loadUpcomingAppointments()
  const { data, error } = await crmTable('appointments').select('*').neq('status', 'cancelled').order('datetime', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToAppt)
}
export async function createAppointment({ leadId, datetime, type = 'in_person', status = 'booked', source = 'staff' }) {
  if (MOCK) return demo.createAppointment({ leadId, datetime, type, status, source })
  const user = await requireUser()
  const row = await checkedMutation(crmTable('appointments').insert({ lead_id: leadId, datetime, type, status, source, created_by: user.id }))
  return rowToAppt(row)
}
export async function updateAppointment(id, fields) {
  if (MOCK) return demo.updateAppointment(id, fields)
  const row = {}
  if (fields.datetime !== undefined) row.datetime = fields.datetime
  if (fields.type !== undefined) row.type = fields.type
  if (fields.status !== undefined) row.status = fields.status
  await checkedMutation(crmTable('appointments').update(row).eq('id', id))
}
export async function deleteAppointment(id) {
  if (MOCK) return demo.deleteAppointment(id)
  await checkedMutation(crmTable('appointments').delete().eq('id', id))
}

// ── staff / profiles ────────────────────────────────────────────────────────
export async function loadProfiles() {
  if (MOCK) return demo.loadProfiles()
  const { data, error } = isSaas
    ? await supabase.rpc('crm_team_profiles')
    : await supabase.from('profiles').select(TEAM_PROFILE_FIELDS).order('name')
  if (error) throw error
  return data || []
}
const WORKER_URL = workerUrl

// Funnel reads and writes deliberately stay behind the Worker. The overview
// includes operational delivery data that should not require browser table
// grants, and every mutation is re-authorised server-side.
function funnelUnavailable(message, status = 0) {
  const error = new Error(message)
  error.name = 'FunnelUnavailableError'
  error.code = 'FUNNEL_UNAVAILABLE'
  error.status = status
  return error
}

async function funnelRequest(path, { method = 'GET', body } = {}) {
  if (MOCK) throw funnelUnavailable('Lead funnel controls are not available in demo mode')
  if (!WORKER_URL) throw funnelUnavailable('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  let res
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
    redirect: 'error',
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...tenantHeaders(), authorization: `Bearer ${session.access_token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (cause) {
    const error = new Error('Could not reach the funnel service')
    error.cause = cause
    error.status = 0
    throw error
  }
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.ok === false) {
    const message = out.error || out.message || `Funnel request failed (${res.status})`
    const unavailable = [404, 405, 501].includes(res.status)
      || ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(out.code)
      || /unknown route|not found|does not exist|schema cache|not installed/i.test(message)
    if (unavailable) throw funnelUnavailable(message, res.status)
    const error = new Error(message)
    error.status = res.status
    error.code = out.code
    throw error
  }
  return out
}

export const isLeadFunnelUnavailableError = (error) => error?.code === 'FUNNEL_UNAVAILABLE'

export async function loadLeadFunnelOverview() {
  return funnelRequest('/lead-funnels/overview')
}

export async function loadLeadFunnelPeople(funnelId, stepId, kind, page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    funnel_id: funnelId,
    step_id: stepId,
    kind,
    page: String(page),
    page_size: String(pageSize),
  })
  return funnelRequest(`/lead-funnels/people?${params}`)
}

export async function updateLeadFunnelSettings(funnelId, patch, steps) {
  return funnelRequest('/lead-funnels/settings', {
    method: 'POST',
    body: {
      funnel_id: funnelId,
      patch,
      ...(steps === undefined ? {} : { steps }),
    },
  })
}

// An empty confirmation requests an exact preview. Committing uses the returned
// count verbatim in the confirmation string: "ENROLL N".
export async function enrollLeadFunnel(funnelId, confirm = '') {
  return funnelRequest('/lead-funnels/enroll', {
    method: 'POST',
    body: { funnel_id: funnelId, confirm },
  })
}

export async function approveLeadFunnelDeliveries(funnelId, deliveryIds, confirmation) {
  return funnelRequest('/lead-funnels/approve', {
    method: 'POST',
    body: { funnel_id: funnelId, delivery_ids: deliveryIds, confirmation },
  })
}

export async function updateLeadFunnelEnrollment(enrollmentId, action) {
  return funnelRequest('/lead-funnels/enrollment', {
    method: 'POST',
    body: { enrollment_id: enrollmentId, action },
  })
}

export async function loadLeadWhatsAppPreference(leadId, countryCode = readLocalWorkspace().countryCode) {
  if (MOCK) {
    const leads = await demo.loadLeads()
    const lead = leads.find((item) => item.id === leadId)
    const stoppedAt = demoWhatsappSuppressions.get(leadId) || null
    const inbound = (await demo.loadMessages())
      .filter((message) => message.lead_id === leadId && message.channel === 'whatsapp' && message.direction === 'in')
      .sort((a, b) => new Date(b.at) - new Date(a.at))[0]
    const lastInboundAt = inbound?.at || null
    const serviceWindowExpiresAt = lastInboundAt
      ? new Date(new Date(lastInboundAt).getTime() + (24 * 60 * 60 * 1000)).toISOString()
      : null
    return {
      ok: true,
      recipient_e164: normalizeWhatsAppPhone(lead?.phone, countryCode),
      consent_whatsapp: lead?.consentWhatsapp === true,
      suppressed: Boolean(stoppedAt),
      reason: stoppedAt ? 'recipient_request' : null,
      source: stoppedAt ? 'recipient' : null,
      suppressed_at: stoppedAt,
      last_inbound_at: lastInboundAt,
      service_window_expires_at: serviceWindowExpiresAt,
      can_send_freeform: Boolean(!stoppedAt && lead?.consentWhatsapp === true
        && serviceWindowExpiresAt && new Date(serviceWindowExpiresAt) > new Date()),
    }
  }
  const params = new URLSearchParams({ lead_id: leadId })
  return funnelRequest(`/leads/whatsapp-preference?${params}`)
}

export async function stopLeadWhatsAppUpdates(leadId, expectedRecipientE164, countryCode = readLocalWorkspace().countryCode) {
  const normalizedRecipient = normalizeWhatsAppPhone(expectedRecipientE164, '')
  if (!normalizedRecipient) throw new Error('A verified WhatsApp number is required')
  if (MOCK) {
    const lead = (await demo.loadLeads()).find((item) => item.id === leadId)
    if (normalizeWhatsAppPhone(lead?.phone, countryCode) !== normalizedRecipient) {
      const error = new Error('The WhatsApp number changed')
      error.status = 409
      error.code = 'recipient_changed'
      throw error
    }
    const stoppedAt = new Date().toISOString()
    demoWhatsappSuppressions.set(leadId, stoppedAt)
    await demo.updateLead(leadId, { consentWhatsapp: false })
    return {
      ok: true,
      state: 'opted_out',
      suppressed: true,
      stopped_count: 0,
      cancelled_count: 0,
      suppressed_at: stoppedAt,
      can_send_freeform: false,
    }
  }
  return workerWrite('/leads/whatsapp-opt-out', {
    lead_id: leadId,
    confirmation: 'OPT OUT',
    expected_recipient_e164: normalizedRecipient,
  })
}

export async function recordLeadWhatsAppConsent(leadId, clientRequestId, confirmation, expectedRecipientE164, countryCode = readLocalWorkspace().countryCode) {
  if (confirmation !== WHATSAPP_CONSENT_CONFIRMATION) {
    throw new Error('Exact WhatsApp consent confirmation is required')
  }
  const normalizedRecipient = normalizeWhatsAppPhone(expectedRecipientE164, '')
  if (!normalizedRecipient) throw new Error('A verified WhatsApp number is required')
  if (MOCK) {
    const lead = (await demo.loadLeads()).find((item) => item.id === leadId)
    if (normalizeWhatsAppPhone(lead?.phone, countryCode) !== normalizedRecipient) {
      const error = new Error('The WhatsApp number changed')
      error.status = 409
      error.code = 'recipient_changed'
      throw error
    }
    if (demoWhatsappSuppressions.has(leadId)) {
      const error = new Error('This contact must reply START before WhatsApp updates can resume')
      error.status = 409
      error.code = 'recipient_start_required'
      throw error
    }
    await demo.updateLead(leadId, { consentWhatsapp: true })
    return {
      ok: true,
      state: 'consent_recorded',
      lead_id: leadId,
      client_request_id: clientRequestId,
      consent_whatsapp: true,
      suppressed: false,
      can_send_freeform: false,
    }
  }
  return workerWrite('/leads/whatsapp-consent', {
    lead_id: leadId,
    client_request_id: clientRequestId,
    confirmation,
    expected_recipient_e164: normalizedRecipient,
  })
}

// which backend integrations are configured (booleans only — no secrets). Powers
// the real status shown on Settings → Channels & AI.
export async function loadHealth() {
  if (MOCK || !WORKER_URL) return { email: false, whatsapp: false, ai: 'none', push: false, demo: MOCK, integrationsConnected: false }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const res = await fetch(`${WORKER_URL}/health`, { headers: { ...tenantHeaders(), authorization: `Bearer ${session.access_token}` }, redirect: 'error' })
    // The Worker intentionally returns a structured health payload with HTTP 503
    // when an integration is degraded. Preserve that payload so Settings can show
    // the failing Meta/queue/template checks instead of reducing it to "unavailable".
    const payload = await res.json().catch(() => null)
    return payload && typeof payload === 'object' ? payload : null
  } catch { return null }
}

export async function syncWhatsappTemplates() {
  if (MOCK) return { ok: true, synced_count: demoWhatsappTemplates().length }
  return workerWrite('/whatsapp/templates/sync', {})
}

export const WHATSAPP_QUICK_REPLY_ACTIONS = [
  'notify_assignee',
  'create_followup_task',
  'send_session_text',
  'send_template',
]

export async function loadWhatsappQuickReplyRules() {
  if (MOCK) return { ok: true, rules: [], allowed_actions: WHATSAPP_QUICK_REPLY_ACTIONS }
  return workerRequest('/whatsapp/quick-reply-rules')
}

export async function saveWhatsappQuickReplyRule(rule) {
  if (MOCK) return { ok: true, rule: { ...rule, id: rule.id || crypto.randomUUID() } }
  return workerRequest('/whatsapp/quick-reply-rules', { method: 'POST', body: rule })
}

export async function deleteWhatsappQuickReplyRule(id) {
  if (MOCK) return { ok: true, id }
  return workerRequest('/whatsapp/quick-reply-rules', { method: 'DELETE', body: { id } })
}

export async function loadWhatsappQuickReplyRuns({ ruleId = '', limit = 50 } = {}) {
  if (MOCK) return { ok: true, runs: [] }
  const params = new URLSearchParams({ limit: String(limit) })
  if (ruleId) params.set('rule_id', ruleId)
  return workerRequest(`/whatsapp/quick-reply-runs?${params}`)
}

export async function insertProfile(fields) {
  if (isSaas) throw new Error('Use workspace invitations. Workspace owners cannot create global login credentials.')
  if (MOCK) return { ok: true, profile: await demo.insertProfile(fields), email_sent: false, message: 'Demo account saved. No email was sent.' }
  return workerWrite('/team/invite', fields)
}
export async function updateTeamAccess(profile, { role, area_access, reason }) {
  if (MOCK) return demo.updateProfile(profile.id, { role, area_access: ['crm'] })
  const { data, error } = await supabase.rpc('update_team_member_access', {
    p_target_id: profile.id,
    p_expected_version: profile.access_version,
    p_role: role,
    p_active: profile.active,
    p_area_access: ['crm'],
    p_reason: reason,
  })
  if (error) throw error
  const saved = Array.isArray(data) ? data[0] : data
  if (!saved?.id) throw new Error('The account update could not be verified. Refresh the team.')
  return saved
}
export async function manageTeamAccount(profile, action, options) {
  if (isSaas) throw new Error('Use workspace membership controls. Global account actions are not available to workspace owners.')
  const payload = accountActionPayload(profile, action, options)
  if (MOCK) {
    const saved = await demo.updateProfile(profile.id, action === 'deactivate'
      ? { active: false, area_access: [] } : { password_change_required: true })
    return { ok: true, profile: saved, email_sent: false, message: 'Demo account updated. No email was sent.' }
  }
  if (action === 'deactivate' && !WORKER_URL) {
    const { data, error } = await supabase.rpc('update_team_member_access', {
      p_target_id: profile.id, p_expected_version: profile.access_version,
      p_role: profile.role, p_active: false, p_area_access: [], p_reason: 'Account deactivated',
    })
    if (error) throw error
    const saved = Array.isArray(data) ? data[0] : data
    if (!saved?.id) throw new Error('The account update could not be verified. Refresh the team.')
    return { ok: true, profile: saved, message: 'Workspace access deactivated.' }
  }
  return workerWrite('/team/account', payload)
}
export async function completeTemporaryPassword(password) {
  if (isSaas) throw new Error('Use your account password recovery link.')
  return workerWrite('/team/password/complete', { password })
}

// ── templates ───────────────────────────────────────────────────────────────
// template <-> row mapping (camelCase app ⇄ snake_case db), incl. media/carousel
const TPL_MAP = {
  name: 'name', channel: 'channel', subject: 'subject', body: 'body', category: 'category',
  headerType: 'header_type', headerText: 'header_text', headerMedia: 'header_media',
  footer: 'footer', buttons: 'buttons', cards: 'cards',
}
const tplToRow = (f) => {
  const row = {}
  for (const [k, v] of Object.entries(f)) if (TPL_MAP[k]) row[TPL_MAP[k]] = v
  return row
}
const rowToTpl = (r) => ({
  id: r.id, name: r.name, channel: r.channel, subject: r.subject || '', body: r.body || '',
  category: r.category || 'utility', headerType: r.header_type || 'none', headerText: r.header_text || '',
  headerMedia: r.header_media || '', footer: r.footer || '', buttons: r.buttons || [], cards: r.cards || [],
  provider: r.provider || null, templateKey: r.template_key || null, language: r.language || null,
  components: r.components || [], parameterSchema: r.parameter_schema || [], status: r.status || null,
  qualityStatus: r.quality_status || null, rejectionReason: r.rejection_reason || null,
  componentsSyncRequired: r.components_sync_required === true,
  syncedAt: r.synced_at || null, updatedAt: r.updated_at,
})

export async function loadTemplates() {
  if (MOCK) return demo.loadTemplates()
  const { data, error } = await crmTable('templates').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToTpl)
}

// Meta WhatsApp Manager is the authoring source of truth. Only templates that
// were synced from Meta and are currently approved are offered by a composer.
export async function loadWhatsappTemplates() {
  if (MOCK) return demoWhatsappTemplates()
  const { data, error } = await crmTable('templates')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('provider', 'meta')
    .order('name', { ascending: true })
  if (error) throw error
  return (data || [])
    .filter((row) => String(row.status || '').toUpperCase() === 'APPROVED')
    .filter((row) => row.components_sync_required !== true)
    .filter((row) => String(row.category || '').toLowerCase() !== 'authentication')
    .map(normalizeWhatsappTemplate)
}
export async function insertTemplate(fields) {
  if (MOCK) return demo.insertTemplate(fields)
  const { data, error } = await crmTable('templates').insert([tplToRow(fields)]).select().single()
  if (error) throw error
  return rowToTpl(data)
}
export async function updateTemplate(id, fields) {
  if (MOCK) return demo.updateTemplate(id, fields)
  await checkedMutation(crmTable('templates').update({ ...tplToRow(fields), updated_at: new Date().toISOString() }).eq('id', id))
}
export async function deleteTemplate(id) {
  if (MOCK) return demo.deleteTemplate(id)
  await checkedMutation(crmTable('templates').delete().eq('id', id))
}

// ── automations ─────────────────────────────────────────────────────────────
const autoRowToApp = (r) => ({
  id: r.id, name: r.name, description: r.description, trigger: r.trigger, channel: r.channel,
  templateId: r.template_id, systemKey: r.system_key || null,
  enabled: r.enabled, lastRun: r.last_run, runCount: r.run_count,
})
export async function loadAutomations() {
  if (MOCK) return demo.loadAutomations()
  const { data, error } = await crmTable('automations').select('*').order('created_at')
  if (error) throw error
  return (data || []).map(autoRowToApp)
}
export async function updateAutomation(id, fields) {
  if (MOCK) {
    await demo.updateAutomation(id, fields)
    return { id, ...fields }
  }
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  if (typeof fields?.enabled !== 'boolean') throw new Error('Only the automation switch can be changed here')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/automation/toggle`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ automation_id: id, enabled: fields.enabled }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.ok) throw new Error(out.error || `Switch failed (${res.status})`)
  return {
    id: out.automation?.id || id,
    enabled: !!out.automation?.enabled,
    systemKey: out.automation?.system_key || null,
  }
}
// In the real backend the actual sending/scoring runs in the Worker; the UI asks for it.
export async function runAutomation(id, options = {}) {
  if (MOCK) return demo.runAutomation(id, options)
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/automation/run`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ automation_id: id, ...options }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.ok) throw new Error(out.error || `Run failed (${res.status})`)
  return {
    count: Number(out.count || 0),
    status: out.status || null,
    remaining: Number(out.remaining || 0),
    requiresConfirmation: !!out.requires_confirmation,
    pendingCount: Number(out.pending_count || 0),
    batchSize: Number(out.batch_size || 0),
    automaticSending: out.automatic_sending === true,
  }
}

// ── messages / automation log ───────────────────────────────────────────────
const normalizeMessageRow = (row) => {
  if (!row) return row
  const mediaMetadata = row.media || row.media_metadata
  const hasMediaMetadata = mediaMetadata && typeof mediaMetadata === 'object'
    && Object.keys(mediaMetadata).length > 0
  const hasMediaColumns = row.media_ref || row.media_storage_key || row.media_mime_type || row.media_file_name
  const outboundStorageRef = String(row.media_storage_key || '').startsWith('whatsapp/outbound/')
    ? String(row.media_storage_key).slice('whatsapp/outbound/'.length)
    : null
  const media = hasMediaMetadata || hasMediaColumns ? {
    ...(hasMediaMetadata ? mediaMetadata : {}),
    ref: mediaMetadata?.ref || mediaMetadata?.media_ref || row.media_ref || outboundStorageRef,
    mime_type: mediaMetadata?.mime_type || row.media_mime_type || null,
    file_name: mediaMetadata?.file_name || row.media_file_name || null,
  } : null
  const contextMetadata = row.context || row.context_metadata
  const hasContext = contextMetadata && typeof contextMetadata === 'object'
    && Object.keys(contextMetadata).length > 0
  const context = hasContext || row.context_provider_message_id ? {
    ...(hasContext ? contextMetadata : {}),
    provider_message_id: contextMetadata?.provider_message_id || row.context_provider_message_id || null,
  } : null
  const quickReplyTrigger = row.quick_reply_trigger || contextMetadata?.quick_reply_trigger || null
  const interaction = {
    action_id: row.action_id || contextMetadata?.action_id || null,
    action_title: row.action_title || contextMetadata?.action_title || null,
    source_template_key: row.source_template_key || contextMetadata?.source_template_key || null,
    preference_action: row.preference_action || contextMetadata?.preference_action || null,
    preference_applied: typeof row.preference_applied === 'boolean'
      ? row.preference_applied : contextMetadata?.preference_applied,
    preference_result_state: row.preference_result_state || contextMetadata?.preference_result_state || null,
    quick_reply_trigger: quickReplyTrigger && typeof quickReplyTrigger === 'object' ? quickReplyTrigger : null,
  }
  const hasInteraction = Object.values(interaction).some(Boolean)
  return {
    ...row,
    at: row.at || row.provider_timestamp || row.created_at || new Date().toISOString(),
    provider_message_id: row.provider_message_id || row.wamid || null,
    wamid: row.wamid || row.provider_message_id || null,
    message_type: row.message_type || row.type || (media ? 'media' : 'text'),
    template_key: row.template_key || row.templateKey || null,
    template_language: row.template_language || row.language || null,
    media,
    context,
    interaction: hasInteraction ? interaction : null,
  }
}

export const mergeMessageChange = (messages, change, direction = 'desc') => {
  const id = change?.old?.id || change?.message?.id
  let next = change?.eventType === 'REFRESH' && Array.isArray(change.messages)
    ? [...change.messages] : (messages || []).filter((message) => message.id !== id)
  if (change?.eventType !== 'DELETE' && change?.message) next.push(change.message)
  return next.sort((a, b) => {
    const delta = new Date(a.at || 0) - new Date(b.at || 0)
    return direction === 'asc' ? delta : -delta
  })
}

export const messageProviderId = (message) => message?.provider_message_id || message?.wamid || null

export const messageMediaRef = (message) => {
  // The authenticated download route resolves inbound attachments by the
  // message wamid. Meta's temporary media id and the private R2 storage key are
  // deliberately not browser-download capabilities.
  if (message?.direction === 'in') return messageProviderId(message)
    || message?.media?.ref || message?.media?.media_ref || message?.media?.private_ref || message?.media_ref || null
  return message?.media?.ref
    || message?.media?.media_ref
    || message?.media?.private_ref
    || message?.media_ref
    || messageProviderId(message)
}

export const messageSafeFailure = (message) => {
  const cancellation = safeWhatsappCancellationDetail(message)
  if (cancellation) return cancellation
  if (message?.status !== 'failed' && message?.status !== 'unknown') return ''
  const code = String(message?.error_code || '').trim()
  const safe = String(message?.safe_error || message?.error_details?.safe_message || message?.error_detail || '')
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, 'provider endpoint')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  if (safe) return `${safe.slice(0, 180)}${code ? ` (${code})` : ''}`
  return code ? `Delivery issue ${code}` : (message.status === 'unknown'
    ? 'Delivery could not be confirmed. It will not be resent automatically.'
    : 'Meta could not deliver this message.')
}

export async function loadMessages() {
  if (MOCK) return (await demo.loadMessages()).map(normalizeMessageRow)
  const { data, error } = await crmTable('messages').select('*').order('at', { ascending: false })
  if (error) throw error
  return (data || []).map(normalizeMessageRow)
}
export async function sendMessage(fields) {
  const payload = fields?.channel === 'whatsapp' ? {
    ...fields,
    kind: fields.kind || (fields.template_key ? 'template' : 'session'),
    client_request_id: fields.client_request_id || crypto.randomUUID(),
  } : fields
  if (MOCK) return normalizeMessageRow(await demo.sendMessage(payload))
  // The Worker owns provider credentials, consent checks, idempotency and the
  // durable outbox. Email deliberately keeps its existing request shape.
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/send`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.ok === false) throw new Error(out.error || `Send failed (${res.status})`)
  if (!out.message) throw new Error('The messaging service returned no message record')
  return normalizeMessageRow(out.message)
}

export function subscribeMessages(onChange, leadId = null) {
  if (MOCK) return () => {}
  if (isSaas) {
    let active = true, pending = false
    const timer = setInterval(async () => {
      if (pending || document.visibilityState !== 'visible') return
      pending = true
      try {
        const messages = await (leadId ? loadLeadMessages(leadId) : loadMessages())
        if (active) onChange({ eventType: 'REFRESH', messages })
      } catch { /* Keep the last verified list; the next scoped refresh retries. */ }
      finally { pending = false }
    }, 20000)
    return () => { active = false; clearInterval(timer) }
  }
  const channel = supabase
    .channel(`crm-messages-${leadId || 'all'}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'messages',
      ...(leadId ? { filter: `lead_id=eq.${leadId}` } : {}),
    }, (payload) => onChange({
      eventType: payload.eventType,
      message: payload.new?.id ? normalizeMessageRow(payload.new) : null,
      old: payload.old || null,
    }))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ── notifications feed ────────────────────────────────────────────────────────
export async function loadNotifications(limit = 100) {
  if (MOCK) return demo.loadNotifications ? demo.loadNotifications() : []
  const { data, error } = await crmTable('notifications').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) { if (/relation|does not exist|schema cache/i.test(error.message || '')) return []; throw error }
  return data || []
}
export async function markNotificationRead(id) {
  if (MOCK) return
  const { error } = await supabase.rpc('mark_notification_read', { nid: id })
  if (error) throw error
}
export async function markAllNotificationsRead() {
  if (MOCK) return
  const { error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
}

// recent activity across all leads (for the home feed). No FK embed — the caller
// resolves the lead name from leads already in memory, which is more robust.
export async function loadRecentActivities(limit = 15) {
  if (MOCK) return demo.loadRecentActivities(limit)
  const { data, error } = await crmTable('activities').select('*').order('at', { ascending: false }).limit(limit)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// latest activity per lead → { [leadId]: activity } for the leads list
export async function loadLatestActivityByLead() {
  const pick = (rows) => { const m = {}; for (const a of rows) if (!m[a.lead_id]) m[a.lead_id] = a; return m }
  if (MOCK) return pick(await demo.loadRecentActivities(1000))
  const rows = await readAllRows('activities')
  return pick(rows.sort((a, b) => new Date(b.at) - new Date(a.at)))
}

// messages for one lead (the conversation shown on the profile)
export async function loadLeadMessages(leadId) {
  if (MOCK) return demo.loadMessages().then((all) => all.filter((m) => m.lead_id === leadId).map(normalizeMessageRow))
  const { data, error } = await crmTable('messages').select('*').eq('lead_id', leadId).order('at', { ascending: true })
  if (error) throw error
  return (data || []).map(normalizeMessageRow)
}

// ── lead-type & form config (multi-channel, admin-managed) ────────────────────
// Types and forms belong to this business. Reads require staff access; writes
// require a manager. Public intake also needs an independently configured service.
export async function loadLeadTypes() {
  if (MOCK) return demo.loadLeadTypes ? demo.loadLeadTypes() : []
  const { data, error } = await crmTable('lead_types').select('*').order('sort', { ascending: true })
  if (error) { if (/relation|does not exist|schema cache/i.test(error.message || '')) return []; throw error }
  return data || []
}
export async function upsertLeadType(row) {
  if (MOCK) return demo.upsertLeadType(row)
  const { error } = await crmTable('lead_types').upsert(row, { onConflict: 'key' })
  if (error) throw error
}
export async function deleteLeadType(key) {
  if (MOCK) return demo.deleteLeadType(key)
  const { error } = await crmTable('lead_types').delete().eq('key', key)
  if (error) throw error
}
export async function loadLeadForms() {
  if (MOCK) return demo.loadLeadForms ? demo.loadLeadForms() : []
  const { data, error } = await crmTable('lead_forms').select('*').order('created_at', { ascending: true })
  if (error) { if (/relation|does not exist|schema cache/i.test(error.message || '')) return []; throw error }
  return data || []
}
export async function upsertLeadForm(row) {
  if (MOCK) return demo.upsertLeadForm(row)
  const { error } = await crmTable('lead_forms').upsert(row, { onConflict: 'form_id' })
  if (error) throw error
}
export async function deleteLeadForm(formId) {
  if (MOCK) return demo.deleteLeadForm(formId)
  const { error } = await crmTable('lead_forms').delete().eq('form_id', formId)
  if (error) throw error
}

const WHATSAPP_MEDIA_LIMITS = new Map([
  ['image/jpeg', 5 * 1024 * 1024], ['image/png', 5 * 1024 * 1024], ['image/webp', 5 * 1024 * 1024],
  ['application/pdf', 25 * 1024 * 1024],
  ['audio/mpeg', 16 * 1024 * 1024], ['audio/ogg', 16 * 1024 * 1024],
  ['audio/mp4', 16 * 1024 * 1024], ['audio/aac', 16 * 1024 * 1024],
  ['video/mp4', 16 * 1024 * 1024],
])
const whatsappMediaType = (mimeType) => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  return 'document'
}

// WhatsApp attachments are always private. Uploads and reads go through the
// authenticated Worker; callers must never persist or render a public R2 URL.
export async function uploadWhatsappMedia(file) {
  if (!file) throw new Error('Choose a file first')
  const limit = WHATSAPP_MEDIA_LIMITS.get(file.type)
  if (!limit) throw new Error('This file type is not supported by WhatsApp')
  if (file.size > limit) throw new Error(`This ${whatsappMediaType(file.type)} must be ${Math.round(limit / 1024 / 1024)} MB or smaller`)
  if (MOCK) throw new Error('Private WhatsApp media is unavailable in demo mode')
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/whatsapp/media?name=${encodeURIComponent(file.name || 'attachment')}`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': file.type, ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: file,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.ok === false || !out.media_ref) throw new Error(out.error || `Upload failed (${res.status})`)
  return {
    ref: out.media_ref,
    mimeType: out.mime_type || file.type,
    type: whatsappMediaType(out.mime_type || file.type),
    fileName: out.file_name || file.name || 'attachment',
  }
}

export async function downloadWhatsappMedia(ref) {
  if (!ref) throw new Error('Attachment reference is missing')
  if (MOCK) throw new Error('Private WhatsApp media is unavailable in demo mode')
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/whatsapp/media/${encodeURIComponent(ref)}`, {
    redirect: 'error',
    headers: { ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) {
    const out = await res.json().catch(() => ({}))
    throw new Error(out.error || `Attachment unavailable (${res.status})`)
  }
  return res.blob()
}

// upload a media file to the Worker (stored on Cloudflare R2); returns a public URL
export async function uploadMedia(file) {
  if (MOCK) throw new Error('Uploads are unavailable in demo mode. Connect your own integration service to enable uploads.')
  if (!WORKER_URL) throw new Error('This integration is not connected. Add your own integration service to enable it.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session && !MOCK) throw new Error('Not signed in')
  const res = await fetch(`${WORKER_URL}/upload?name=${encodeURIComponent(file.name || 'file')}`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', authorization: `Bearer ${session?.access_token || ''}` },
    body: file,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.ok) throw new Error(out.error || `Upload failed (${res.status})`)
  return out.url
}
