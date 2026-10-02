// Shared, industry-neutral defaults. Workspace categories can be customized.

export const QUAL = ['Not Yet Contacted', 'Qualified', 'Unqualified']

export const JOURNEY = [
  'New Lead',
  'Discovery',
  'Proposal Sent',
  'Negotiation',
  'Follow-up Ongoing',
  'Closed Won',
  'Closed Lost',
  'Not Interested',
  'Unresponsive',
]

export const PRIORITIES = ['High', 'Medium', 'Low']

export const SOURCE_CHANNELS = [
  { v: '', l: '—' },
  { v: 'meta', l: 'Meta ad' },
  { v: 'website', l: 'Website' },
  { v: 'google_form', l: 'Google Form' },
  { v: 'whatsapp', l: 'WhatsApp' },
  { v: 'walk_in', l: 'Walk-in / phone' },
  { v: 'referral', l: 'Referral' },
  { v: 'email', l: 'Email' },
  { v: 'event', l: 'Event' },
  { v: 'partner', l: 'Partner' },
  { v: 'other', l: 'Other' },
]

// ── lead types (multi-channel) ──────────────────────────────────────────────
// Lead types are DB-driven (public.lead_types, managed by admins in Settings) so new
// categories need NO code change. This is the fallback used before the config loads and
// in demo mode. Pass the loaded rows to the helpers
// (leadTypeLabel(key, types)) to reflect admin edits.
export const LEAD_TYPES_FALLBACK = [
  { key: 'sales',        label: 'Sales enquiry',   color: 'info'    },
  { key: 'service',      label: 'Service request', color: 'warning' },
  { key: 'partnership',  label: 'Partnership',     color: 'success' },
  { key: 'webinar',      label: 'Webinar',         color: 'success' },
  { key: 'event',        label: 'Event',           color: 'danger'  },
  { key: 'download',     label: 'Download',        color: 'neutral' },
  { key: 'marketing',    label: 'Marketing',       color: 'success' },
  { key: 'general',      label: 'General Inquiry', color: 'neutral' },
]
export const WEBSITE_LEAD_TYPE = { key: 'website', label: 'Website', color: 'info' }
const titleCase = (s) => (s ? String(s).replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replace(/[_-]/g, ' ') : '')
export const leadTypeLabel = (key, types) =>
  (types && types.length ? types : LEAD_TYPES_FALLBACK).find((t) => t.key === key)?.label || titleCase(key) || '—'
export const leadTypePill = (key, types) =>
  (types && types.length ? types : LEAD_TYPES_FALLBACK).find((t) => t.key === key)?.color || 'neutral'

// Website is an intake origin, while lead_type is the underlying enquiry category.
// For staff-facing type summaries, website origin takes precedence so existing and
// future website enquiries are recognisable without rewriting their stored category.
export const isWebsiteLead = (lead) => {
  const sourceChannel = String(lead?.sourceChannel || '').trim().toLowerCase()
  const platform = String(lead?.platform || '').trim().toLowerCase()
  const source = String(lead?.source || '').trim().toLowerCase()
  return sourceChannel === 'website' || platform === 'website' || /\bwebsite\b/.test(source)
}
export const displayLeadTypeKey = (lead) => isWebsiteLead(lead) ? WEBSITE_LEAD_TYPE.key : (lead?.leadType || 'general')
export const displayLeadTypeLabelForKey = (key, types) => key === WEBSITE_LEAD_TYPE.key
  ? WEBSITE_LEAD_TYPE.label
  : leadTypeLabel(key, types)
export const displayLeadTypePillForKey = (key, types) => key === WEBSITE_LEAD_TYPE.key
  ? WEBSITE_LEAD_TYPE.color
  : leadTypePill(key, types)
export const displayLeadTypeLabel = (lead, types) => displayLeadTypeLabelForKey(displayLeadTypeKey(lead), types)
export const displayLeadTypePill = (lead, types) => displayLeadTypePillForKey(displayLeadTypeKey(lead), types)
export const displayLeadTypeOptions = (types) => {
  const configured = types && types.length ? types : LEAD_TYPES_FALLBACK
  return [WEBSITE_LEAD_TYPE, ...configured.filter((type) => type.key !== WEBSITE_LEAD_TYPE.key)]
}

export const ACTIVITY_TYPES = ['Call', 'Email', 'Meeting', 'WhatsApp', 'Note', 'Other']

// ── appointments ──────────────────────────────────────────────────────────
export const APPT_TYPES = [
  { v: 'in_person', l: 'In person' },
  { v: 'virtual',   l: 'Video call' },
  { v: 'phone',     l: 'Phone call' },
  { v: 'on_site',   l: 'On-site visit' },
]
export const apptTypeLabel = (v) => APPT_TYPES.find((t) => t.v === v)?.l || ({ clinic: 'In person', at_home: 'On-site visit' }[v]) || v || '—'
export const APPT_STATUSES = ['booked', 'confirmed', 'completed', 'no_show', 'cancelled']
export const apptStatusLabel = (s) =>
  ({ booked: 'Scheduled', confirmed: 'Confirmed', completed: 'Completed', attended: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' }[s] || s)
export const apptStatusPill = (s) =>
  ({ booked: 'info', confirmed: 'success', completed: 'success', attended: 'success', no_show: 'danger', cancelled: 'neutral' }[s] || 'neutral')

// pill colour class for each status
export const qualPill = (s) =>
  s === 'Qualified' ? 'success' : s === 'Unqualified' ? 'danger' : 'warning'

export const journeyPill = (s) =>
  ({
    'New Lead': 'info',
    'Discovery': 'info',
    'Proposal Sent': 'warning',
    'Negotiation': 'warning',
    'Follow-up Ongoing': 'warning',
    'Closed Won': 'success',
    'Closed Lost': 'danger',
    'Not Interested': 'neutral',
    'Unresponsive': 'info',
  }[s] || 'neutral')

export const priorityPill = (p) =>
  p === 'High' ? 'success' : p === 'Medium' ? 'warning' : p === 'Low' ? 'danger' : 'neutral'

// ── messaging / automation ──────────────────────────────────────────────────
export const CHANNELS = [
  { v: 'whatsapp', l: 'WhatsApp' },
  { v: 'email', l: 'Email' },
  { v: 'sms', l: 'SMS' },
  { v: 'ai', l: 'AI' },
]
export const channelLabel = (v) => CHANNELS.find((c) => c.v === v)?.l || v || '—'
export const channelPill = (v) =>
  ({ whatsapp: 'success', email: 'info', sms: 'warning', ai: 'neutral' }[v] || 'neutral')

export const MESSAGE_STATUS = ['queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'received', 'failed', 'unknown', 'cancelled']
export const messageStatusPill = (s) =>
  ({
    queued: 'neutral', sending: 'warning', accepted: 'info', sent: 'info', delivered: 'info',
    read: 'success', received: 'warning', failed: 'danger', unknown: 'warning', cancelled: 'neutral',
  }[s] || 'neutral')

export const messageStatusLabel = (status) => ({
  queued: 'Queued', sending: 'Sending', accepted: 'Accepted', sent: 'Sent', delivered: 'Delivered',
  read: 'Read', received: 'Received', failed: 'Failed', unknown: 'Needs review', cancelled: 'Cancelled',
}[status] || status || 'Unknown')

// automation triggers — keep keys stable; labels are what staff read
export const TRIGGERS = {
  'lead.created': 'New record arrives',
  'appointment.upcoming': 'Meeting in 24h',
  'session.upcoming': 'Event / session tomorrow',
  'lead.idle.3d': 'No reply for 3 days',
  'lead.idle.30d': 'Cold for 30 days',
}
export const triggerLabel = (t) => TRIGGERS[t] || t
