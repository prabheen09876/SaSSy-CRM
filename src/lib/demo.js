// In-memory demo backend. Used automatically when there's no Supabase .env,
// so the whole frontend is viewable/clickable before the real DB is set up.
// Same function names + data shape as db.js → swapping to real Supabase is zero rewrites.

import { scoreLead } from './ai'
import { defaultPlatforms } from './teamAccounts'
import { LEAD_TYPES_FALLBACK } from './constants'

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2))
const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().split('T')[0] }
const ts = (off, h = 10) => { const d = new Date(); d.setDate(d.getDate() + off); d.setHours(h, 0, 0, 0); return d.toISOString() }

export let demoProfiles = [
  { id: 'p-admin',   name: 'Alex Morgan', role: 'admin',       active: true, email: 'alex@example.com' },
  { id: 'p-manager', name: 'Sam Rivera', role: 'sub-admin',   active: true, email: 'sam@example.com' },
  { id: 'p-satyam',  name: 'Jordan Lee', role: 'coordinator', active: true, email: 'jordan@example.com' },
  { id: 'p-sakshi',  name: 'Casey Brown', role: 'coordinator', active: true, email: 'casey@example.com' },
  { id: 'p-recep',   name: 'Taylor Kim', role: 'reception',   active: true, email: 'taylor@example.com' },
  { id: 'p-mktg',    name: 'Avery Patel', role: 'marketing',   active: true, email: 'avery@example.com' },
].map((profile) => ({ ...profile, area_access: defaultPlatforms(profile.role), access_version: 1, password_change_required: false }))

const base = {
  phone: '', email: '', source: '', sourceChannel: '', leadType: 'general',
  company: '', jobTitle: '', city: '', website: '', interest: '', budget: null, currency: 'USD', expectedCloseDate: '',
  qualStatus: 'Not Yet Contacted', journeyStatus: 'New Lead', score: '', aiScore: '', aiSummary: '',
  followupDate: '', followupTime: '', assignedTo: '', priority: '', remarks: '',
  consentWhatsapp: false, consentEmail: false,
  lastActivity: '',
}
const mk = (p) => ({ id: uid(), createdAt: new Date().toISOString(), ...base, ...p, customFields: { ...(p.customFields || {}) } })

let leads = [
  mk({ name: 'Maya Chen', phone: '+12025550101', email: 'maya@example.com', company: 'Greenline Studio', jobTitle: 'Founder', city: 'Seattle', website: 'https://example.com',
    source: 'Referral', sourceChannel: 'referral', leadType: 'sales', interest: 'Brand strategy and website', budget: 8500, expectedCloseDate: day(14),
    qualStatus: 'Qualified', journeyStatus: 'Proposal Sent', score: '86', priority: 'High', assignedTo: 'p-satyam', followupDate: day(0), followupTime: '15:00',
    remarks: 'Proposal shared. Review scope and delivery dates on the next call.' }),
  mk({ name: 'Noah Patel', phone: '+12025550102', email: 'noah@example.com', company: 'Summit Homes', jobTitle: 'Sales Director', city: 'Austin',
    source: 'Website', sourceChannel: 'website', leadType: 'sales', interest: 'Commercial property enquiry', budget: 45000,
    followupDate: day(1), followupTime: '11:30', assignedTo: 'p-recep' }),
  mk({ name: 'Sofia Garcia', phone: '+12025550103', email: 'sofia@example.com', company: 'Northstar Learning', jobTitle: 'Program Manager', city: 'Madrid',
    source: 'Webinar', sourceChannel: 'event', leadType: 'service', interest: 'Team training program', budget: 6000,
    qualStatus: 'Qualified', journeyStatus: 'Discovery', assignedTo: 'p-satyam', followupDate: day(2), remarks: 'Discuss audience, learning outcomes and preferred dates.' }),
  mk({ name: 'Ethan Brooks', phone: '+12025550104', email: 'ethan@example.com', company: 'Harbor Consulting', jobTitle: 'Partner', city: 'London',
    source: 'Referral', sourceChannel: 'referral', leadType: 'partnership', interest: 'Annual advisory services', budget: 18000, expectedCloseDate: day(-3),
    qualStatus: 'Qualified', journeyStatus: 'Closed Won', score: '100', priority: 'High', assignedTo: 'p-sakshi', remarks: 'Agreement signed. Arrange the kickoff meeting.' }),
  mk({ name: 'Amara Okafor', phone: '+12025550105', email: 'amara@example.com', company: 'Fieldwork Supply', jobTitle: 'Procurement Manager', city: 'Lagos',
    source: 'Trade show', sourceChannel: 'event', leadType: 'sales', interest: 'Equipment supply contract', budget: 32000,
    journeyStatus: 'Unresponsive', priority: 'Medium', followupDate: day(-2), followupTime: '14:00', assignedTo: 'p-satyam' }),
  mk({ name: 'Liam Wilson', phone: '+12025550106', email: 'liam@example.com', company: 'Brightway Software', jobTitle: 'Operations Lead', city: 'Toronto',
    source: 'Website', sourceChannel: 'website', leadType: 'sales', interest: 'Team software subscription', budget: 12000, expectedCloseDate: day(8),
    qualStatus: 'Qualified', journeyStatus: 'Negotiation', score: '90', assignedTo: 'p-sakshi', priority: 'High', followupDate: day(3), followupTime: '13:00' }),
  mk({ name: 'Priya Shah', phone: '+12025550107', email: 'priya@example.com', company: 'Cedar Events', jobTitle: 'Event Planner', city: 'Mumbai',
    source: 'Email', sourceChannel: 'email', leadType: 'service', interest: 'Conference production', budget: 9500,
    journeyStatus: 'Follow-up Ongoing', followupDate: day(0), followupTime: '11:00', assignedTo: 'p-recep' }),
  mk({ name: 'Oliver Smith', phone: '+12025550108', email: 'oliver@example.com', company: 'Atlas Retail', jobTitle: 'Owner', city: 'Melbourne',
    source: 'Partner', sourceChannel: 'partner', leadType: 'sales', interest: 'Store refurbishment', budget: 25000,
    qualStatus: 'Qualified', journeyStatus: 'Closed Lost', remarks: 'Selected another supplier. Budget was the deciding factor.' }),
]

let activities = [
  { id: uid(), lead_id: leads[0].id, type: 'Email', notes: 'Shared proposal and two project options. Decision expected next week.', at: ts(-1, 16), by: 'p-satyam' },
  { id: uid(), lead_id: leads[0].id, type: 'Call', notes: 'Discussed objectives, budget and the decision process. Follow-up agreed.', at: ts(-3, 19), by: 'p-satyam' },
  { id: uid(), lead_id: leads[5].id, type: 'Meeting', notes: 'Product walkthrough completed. Preparing final terms for a 20-person team.', at: ts(-2, 12), by: 'p-sakshi' },
]

// ── templates ───────────────────────────────────────────────────────────────
let templates = [
  { id: 't-welcome', name: 'Welcome — WhatsApp', channel: 'whatsapp', subject: '',
    body: 'Hi {{name}}, thanks for getting in touch. I’m {{staff}} from the team. What would you like to achieve, and when is a good time to talk?', updatedAt: ts(-20) },
  { id: 't-booking', name: 'Meeting reminder — WhatsApp', channel: 'whatsapp', subject: '',
    body: 'Hi {{name}}, a reminder of our meeting on {{date}} at {{time}}. Reply to confirm or let us know if you need to reschedule.', updatedAt: ts(-12) },
  { id: 't-nudge', name: 'Gentle follow-up — WhatsApp', channel: 'whatsapp', subject: '',
    body: 'Hi {{name}}, following up on our conversation. Is there any information you need from us to decide on the next step?', updatedAt: ts(-8) },
  { id: 't-email-welcome', name: 'Welcome — Email', channel: 'email', subject: 'Thanks for your enquiry',
    body: 'Hello {{name}},\n\nThank you for getting in touch. We would love to understand your requirements, timeline and budget so we can recommend the right next step.\n\nLet us know a convenient time to connect.\n\nBest regards,\nThe team', updatedAt: ts(-15) },
  { id: 't-reactivate', name: 'Win-back — WhatsApp', channel: 'whatsapp', subject: '',
    body: 'Hi {{name}}, are you still considering the project we discussed? Happy to share an updated proposal if your plans have changed.', updatedAt: ts(-30) },
]

// ── automations ─────────────────────────────────────────────────────────────
let automations = [
  { id: 'a-welcome',    name: 'Instant welcome',          description: 'A new lead gets a warm WhatsApp within a minute of arriving.', trigger: 'lead.created',         channel: 'whatsapp', templateId: 't-welcome',    enabled: true,  lastRun: ts(0, 9),  runCount: 132 },
  { id: 'a-score',      name: 'Lead scoring',          description: 'Local rules score each lead 0–100 and explain every scoring factor.', trigger: 'lead.created',     channel: 'ai',       templateId: null,           enabled: true,  lastRun: ts(0, 9),  runCount: 132 },
  { id: 'a-booking',    name: 'Meeting reminder',         description: 'Meeting in 24 hours → reminder to the contact.',            trigger: 'appointment.upcoming', channel: 'whatsapp', templateId: 't-booking',    enabled: true,  lastRun: ts(-1, 18), runCount: 47 },
  { id: 'a-nudge',      name: 'No-response nudge',        description: 'Paused by default. A manager reviews every due WhatsApp batch.',  trigger: 'lead.idle.3d',         channel: 'whatsapp', templateId: 't-nudge', systemKey: 'lead_followup_due_whatsapp', enabled: false, lastRun: ts(-1, 10), runCount: 63 },
  { id: 'a-class',      name: 'Event & session reminders', description: 'Anyone enrolled in a session gets a reminder the day before.',   trigger: 'session.upcoming',     channel: 'whatsapp', templateId: null,           enabled: true,  lastRun: ts(-2, 8),  runCount: 21 },
  { id: 'a-reactivate', name: 'Win-back',                 description: 'Cold for 30 days → a re-engagement offer.',                       trigger: 'lead.idle.30d',        channel: 'whatsapp', templateId: 't-reactivate', enabled: false, lastRun: null,       runCount: 9 },
]

// ── messages / automation log ───────────────────────────────────────────────
let messages = [
  { id: uid(), lead_id: leads[0].id, channel: 'whatsapp', direction: 'out', status: 'read',      body: 'Hi Maya, thanks for your enquiry. When would be a good time to discuss your project?', automationId: 'a-welcome', at: ts(-1, 16), by: null },
  { id: uid(), lead_id: leads[0].id, channel: 'whatsapp', direction: 'in',  status: 'received',  body: 'Yes please, evenings work best for me.',          automationId: null,        at: ts(-1, 17), by: null },
  { id: uid(), lead_id: leads[3].id, channel: 'email',    direction: 'out', status: 'delivered', body: 'Thank you for confirming. Here are the next steps for our kickoff.', automationId: null, at: ts(-2, 11), by: 'p-sakshi' },
  { id: uid(), lead_id: leads[4].id, channel: 'whatsapp', direction: 'out', status: 'delivered', body: 'Hi Amara, following up on the equipment proposal. Can we help with any questions?', automationId: 'a-nudge', at: ts(-1, 10), by: null },
  { id: uid(), lead_id: leads[1].id, channel: 'whatsapp', direction: 'out', status: 'sent',      body: 'Hi Noah, thanks for getting in touch. Let us discuss your requirements.', automationId: 'a-welcome', at: ts(0, 9), by: null },
  { id: uid(), lead_id: leads[5].id, channel: 'whatsapp', direction: 'out', status: 'failed',    body: 'Hi Liam, your updated proposal is ready for review.', automationId: 'a-welcome', at: ts(0, 9), by: null },
]

let trash = []   // soft-deleted leads live here until restored or purged

const wait = (v) => new Promise((r) => setTimeout(() => r(v), 60))
const clone = (a) => structuredClone(a)

// ── leads ─────────────────────────────────────────────────────────────────
export const loadLeads = () => wait(clone(leads))
export function insertLead(fields) {
  const lead = mk(fields)
  leads = [lead, ...leads]
  return wait({ ...lead })
}
export function updateLead(id, fields) {
  leads = leads.map((l) => (l.id === id ? { ...l, ...fields } : l))
  return wait()
}
// soft delete → move to the Bin (activities are kept so a restore is clean)
export function deleteLead(id) {
  const l = leads.find((x) => x.id === id)
  leads = leads.filter((x) => x.id !== id)
  if (l) trash = [{ ...l, deletedAt: new Date().toISOString() }, ...trash]
  return wait()
}

// ── bin / trash ─────────────────────────────────────────────────────────────
export const loadTrash = () => wait(clone(trash))
export function restoreLead(id) {
  const l = trash.find((x) => x.id === id)
  trash = trash.filter((x) => x.id !== id)
  if (l) { const { deletedAt, ...rest } = l; leads = [rest, ...leads] }
  return wait({ ...(l || {}) })
}
export function purgeLead(id) {
  trash = trash.filter((x) => x.id !== id)
  activities = activities.filter((a) => a.lead_id !== id)
  return wait()
}
export function emptyTrash() {
  const ids = new Set(trash.map((t) => t.id))
  activities = activities.filter((a) => !ids.has(a.lead_id))
  trash = []
  return wait()
}

// ── activities ──────────────────────────────────────────────────────────────
export const loadActivities = (leadId) =>
  wait(activities.filter((a) => a.lead_id === leadId).sort((a, b) => new Date(b.at) - new Date(a.at)).map((a) => ({ ...a })))
export function loadRecentActivities(limit = 15) {
  const byId = Object.fromEntries(leads.map((l) => [l.id, l.name]))
  const rows = activities.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit)
    .map((a) => ({ ...a, leadName: byId[a.lead_id] || '' }))
  return wait(rows)
}
export function addActivity(leadId, { type, notes, at, by }) {
  const a = { id: uid(), lead_id: leadId, type, notes, at: at || new Date().toISOString(), by: by || 'p-admin' }
  activities = [a, ...activities]
  return wait({ ...a })
}
export function deleteActivity(id) {
  activities = activities.filter((a) => a.id !== id)
  return wait()
}

// ── appointments ──────────────────────────────────────────────────────────
let appointments = [
  { id: uid(), lead_id: leads[0].id, datetime: ts(1, 15), type: 'virtual', status: 'confirmed', source: 'staff', created_by: 'p-satyam', created_at: ts(-1) },
  { id: uid(), lead_id: leads[3].id, datetime: ts(2, 11), type: 'in_person', status: 'booked', source: 'staff', created_by: 'p-sakshi', created_at: ts(-1) },
]
const rowA = (a) => ({ id: a.id, leadId: a.lead_id, datetime: a.datetime, type: a.type, status: a.status, source: a.source, createdBy: a.created_by, createdAt: a.created_at })
export const loadAppointments = (leadId) =>
  wait(appointments.filter((a) => a.lead_id === leadId).sort((x, y) => new Date(x.datetime) - new Date(y.datetime)).map(rowA))
export const loadUpcomingAppointments = () =>
  wait(appointments.filter((a) => a.status !== 'cancelled').sort((x, y) => new Date(x.datetime) - new Date(y.datetime)).map(rowA))
export function createAppointment({ leadId, datetime, type, status, source }) {
  const a = { id: uid(), lead_id: leadId, datetime, type: type || 'in_person', status: status || 'booked', source: source || 'staff', created_by: 'p-admin', created_at: new Date().toISOString() }
  appointments = [a, ...appointments]
  return wait(rowA(a))
}
export function updateAppointment(id, fields) {
  appointments = appointments.map((a) => (a.id === id
    ? { ...a, datetime: fields.datetime ?? a.datetime, type: fields.type ?? a.type, status: fields.status ?? a.status } : a))
  return wait()
}
export function deleteAppointment(id) {
  appointments = appointments.filter((a) => a.id !== id)
  return wait()
}

// ── staff / profiles ────────────────────────────────────────────────────────
export const loadProfiles = () => wait(clone(demoProfiles))
export function insertProfile(fields) {
  // Keep password input out of the demo data store as well as production tables.
  const existing = demoProfiles.find((profile) => profile.email.toLowerCase() === fields.email.toLowerCase())
  if (existing?.active) return Promise.reject(new Error('This person is already an active team member.'))
  const p = { id: existing?.id || uid(), active: true, name: fields.name, email: fields.email, role: fields.role,
    area_access: fields.area_access, access_version: (existing?.access_version || 0) + 1, password_change_required: true }
  demoProfiles = [...demoProfiles.filter((profile) => profile.id !== p.id), p]
  return wait({ ...p })
}
export function updateProfile(id, fields) {
  demoProfiles = demoProfiles.map((p) => (p.id === id ? { ...p, ...fields, access_version: p.access_version + 1 } : p))
  return wait({ ...demoProfiles.find((profile) => profile.id === id) })
}

// ── templates ───────────────────────────────────────────────────────────────
export const loadTemplates = () => wait(clone(templates))
export function insertTemplate(fields) {
  const t = {
    id: uid(), channel: 'whatsapp', subject: '', body: '', category: 'utility',
    headerType: 'none', headerText: '', headerMedia: '', footer: '', buttons: [], cards: [],
    updatedAt: new Date().toISOString(), ...fields,
  }
  templates = [t, ...templates]
  return wait({ ...t })
}
export function updateTemplate(id, fields) {
  templates = templates.map((t) => (t.id === id ? { ...t, ...fields, updatedAt: new Date().toISOString() } : t))
  return wait()
}
export function deleteTemplate(id) {
  templates = templates.filter((t) => t.id !== id)
  return wait()
}

// ── automations ─────────────────────────────────────────────────────────────
export const loadAutomations = () => wait(clone(automations))
export function updateAutomation(id, fields) {
  automations = automations.map((a) => (a.id === id ? { ...a, ...fields } : a))
  return wait()
}
// Simulate a run: create out-bound messages for a few eligible leads, score on AI rules.
export function runAutomation(id, options = {}) {
  const auto = automations.find((a) => a.id === id)
  if (!auto) return wait({ count: 0 })
  if (auto.trigger === 'lead.idle.3d' && auto.channel === 'whatsapp' && options.confirm !== true) {
    return wait({ requiresConfirmation: true, pendingCount: 3, batchSize: 3, automaticSending: false })
  }
  let count = 0
  if (auto.channel === 'ai') {
    leads.filter((l) => !l.aiScore).slice(0, 5).forEach((l) => {
      const { score, summary } = scoreLead(l)
      leads = leads.map((x) => (x.id === l.id ? { ...x, aiScore: String(score), aiSummary: summary } : x))
      count++
    })
  } else {
    const eligible = leads.filter((l) => !['Closed Won', 'Closed Lost', 'Not Interested'].includes(l.journeyStatus)).slice(0, 3)
    const tpl = templates.find((t) => t.id === auto.templateId)
    eligible.forEach((l) => {
      messages = [{
        id: uid(), lead_id: l.id, channel: auto.channel, direction: 'out', status: 'sent',
        body: (tpl?.body || auto.name).replace(/\{\{name\}\}/g, (l.name || '').split(' ')[0] || 'there'),
        automationId: auto.id, at: new Date().toISOString(), by: null,
      }, ...messages]
      count++
    })
  }
  automations = automations.map((a) => (a.id === id ? { ...a, lastRun: new Date().toISOString(), runCount: a.runCount + count } : a))
  return wait({ count, remaining: 0, automaticSending: false })
}

// ── messages ────────────────────────────────────────────────────────────────
export const loadMessages = () =>
  wait(messages.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).map((m) => ({ ...m })))

// Demo-mode parity with the real notifications table. Keeping the same shape
// prevents the CRM shell from failing while polling the notification badge.
export const loadNotifications = () => wait([])
export function sendMessage(fields) {
  const m = {
    id: uid(), channel: 'whatsapp', direction: 'out', status: fields.channel === 'whatsapp' ? 'queued' : 'sent', automationId: null,
    at: new Date().toISOString(), ...fields,
  }
  messages = [m, ...messages]
  return wait({ ...m })
}

// Demo configuration changes remain available for the current preview session.
let leadTypes = LEAD_TYPES_FALLBACK.map((type, index) => ({ ...type, default_source: '', sort: (index + 1) * 10, active: true }))
let leadForms = []
export const loadLeadTypes = () => wait(clone(leadTypes).sort((a, b) => a.sort - b.sort))
export function upsertLeadType(fields) {
  const current = leadTypes.find((type) => type.key === fields.key)
  const type = { color: 'neutral', default_source: '', sort: 100, active: true, ...current, ...fields }
  leadTypes = [...leadTypes.filter((item) => item.key !== type.key), type]
  return wait({ ...type })
}
export function deleteLeadType(key) {
  leadTypes = leadTypes.filter((type) => type.key !== key)
  return wait()
}
export const loadLeadForms = () => wait(clone(leadForms))
export function upsertLeadForm(fields) {
  const current = leadForms.find((form) => form.form_id === fields.form_id)
  const form = { ...current, ...fields }
  leadForms = [...leadForms.filter((item) => item.form_id !== form.form_id), form]
  return wait({ ...form })
}
export function deleteLeadForm(formId) {
  leadForms = leadForms.filter((form) => form.form_id !== formId)
  return wait()
}
