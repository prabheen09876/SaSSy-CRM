import { JOURNEY } from './constants.js'

export const WORKSPACE_STORAGE_KEY = 'crm.workspace.v1'

export const DEFAULT_TERMINOLOGY = Object.freeze({
  recordSingular: 'Lead',
  recordPlural: 'Leads',
  opportunitySingular: 'Opportunity',
  opportunityPlural: 'Opportunities',
})

const stageLabels = (labels = []) => Object.fromEntries(JOURNEY.map((stage, index) => [stage, labels[index] || stage]))

export const INDUSTRY_PRESETS = [
  {
    id: 'general', label: 'Any business', description: 'A flexible starting point for your team.',
    terminology: DEFAULT_TERMINOLOGY,
    stageLabels: stageLabels(),
    customFields: [],
  },
  {
    id: 'services', label: 'Professional services', description: 'Track prospects, proposals, and the projects clients need.',
    terminology: { recordSingular: 'Prospect', recordPlural: 'Prospects', opportunitySingular: 'Project', opportunityPlural: 'Projects' },
    stageLabels: stageLabels(['New enquiry', 'Needs review', 'Scope shared', 'Decision pending', 'Active follow-up', 'Converted', 'Not converted', 'Not proceeding', 'No response']),
    customFields: [
    { key: 'service_needed', label: 'Service needed', type: 'text' },
    { key: 'project_budget', label: 'Project budget', type: 'number' },
    { key: 'target_start', label: 'Target start date', type: 'date' },
  ] },
  {
    id: 'real_estate', label: 'Real estate', description: 'Keep buyer requirements, viewings, and offers together.',
    terminology: { recordSingular: 'Buyer', recordPlural: 'Buyers', opportunitySingular: 'Deal', opportunityPlural: 'Deals' },
    stageLabels: stageLabels(['New enquiry', 'Needs verified', 'Options shared', 'Offer / negotiation', 'Active follow-up', 'Deal closed', 'Deal lost', 'Not interested', 'No response']),
    customFields: [
    { key: 'property_type', label: 'Property type', type: 'select', options: ['Apartment', 'House', 'Commercial', 'Land', 'Other'] },
    { key: 'preferred_location', label: 'Preferred location', type: 'text' },
    { key: 'property_budget', label: 'Budget', type: 'number' },
  ] },
  {
    id: 'education', label: 'Education & training', description: 'Organize enquiries, applications, and enrolment.',
    terminology: { recordSingular: 'Enquiry', recordPlural: 'Enquiries', opportunitySingular: 'Enrolment', opportunityPlural: 'Enrolments' },
    stageLabels: stageLabels(['New enquiry', 'Counselling', 'Application shared', 'Application review', 'Active follow-up', 'Enrolled', 'Not enrolled', 'Not interested', 'No response']),
    customFields: [
    { key: 'course_interest', label: 'Course of interest', type: 'text' },
    { key: 'study_mode', label: 'Study mode', type: 'select', options: ['Online', 'In person', 'Hybrid'] },
    { key: 'intake_date', label: 'Preferred intake date', type: 'date' },
  ] },
  {
    id: 'retail', label: 'Retail & commerce', description: 'Capture customer needs, quotes, and sales.',
    terminology: { recordSingular: 'Customer', recordPlural: 'Customers', opportunitySingular: 'Sale', opportunityPlural: 'Sales' },
    stageLabels: stageLabels(['New enquiry', 'Needs confirmed', 'Quote shared', 'Decision pending', 'Active follow-up', 'Order placed', 'Order lost', 'Not interested', 'No response']),
    customFields: [
    { key: 'product_interest', label: 'Product of interest', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'purchase_timeline', label: 'Purchase timeline', type: 'select', options: ['Immediately', 'This month', 'Later', 'Exploring'] },
  ] },
  {
    id: 'healthcare', label: 'Healthcare & wellness', description: 'Coordinate service enquiries and appointment preferences.',
    terminology: { recordSingular: 'Enquiry', recordPlural: 'Enquiries', opportunitySingular: 'Booking', opportunityPlural: 'Bookings' },
    stageLabels: stageLabels(['New enquiry', 'Initial conversation', 'Plan shared', 'Booking decision', 'Active follow-up', 'Booked', 'Not proceeding', 'Not interested', 'No response']),
    customFields: [
    { key: 'service_interest', label: 'Service of interest', type: 'text' },
    { key: 'preferred_location', label: 'Preferred location', type: 'text' },
    { key: 'preferred_date', label: 'Preferred appointment date', type: 'date' },
  ] },
]

export const DEFAULT_WORKSPACE = Object.freeze({
  name: 'Workspace CRM',
  industry: 'general',
  currency: 'INR',
  countryCode: '91',
  website: '',
  phone: '',
  city: '',
  terminology: DEFAULT_TERMINOLOGY,
  stageLabels: Object.freeze(stageLabels()),
  customFields: Object.freeze([]),
  setupComplete: false,
})

const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const fieldTypes = new Set(['text', 'number', 'date', 'select'])
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])

const normalizeTerminology = (value = {}, fallback = DEFAULT_TERMINOLOGY) => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    recordSingular: text(input.recordSingular, 40) || fallback.recordSingular,
    recordPlural: text(input.recordPlural, 40) || fallback.recordPlural,
    opportunitySingular: text(input.opportunitySingular, 40) || fallback.opportunitySingular,
    opportunityPlural: text(input.opportunityPlural, 40) || fallback.opportunityPlural,
  }
}

const normalizeStageLabels = (value = {}, fallback = stageLabels()) => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(JOURNEY.map((stage) => [stage, text(input[stage], 60) || fallback[stage] || stage]))
}

export const workspaceTerminology = (settings = {}) => {
  const preset = INDUSTRY_PRESETS.find((item) => item.id === settings?.industry) || INDUSTRY_PRESETS[0]
  const terms = normalizeTerminology(settings?.terminology, preset.terminology)
  return {
    ...terms,
    record: lowerFirst(terms.recordSingular),
    records: lowerFirst(terms.recordPlural),
    opportunity: lowerFirst(terms.opportunitySingular),
    opportunities: lowerFirst(terms.opportunityPlural),
  }
}

export const workspaceStageLabel = (settings, stage) => {
  if (!stage) return ''
  const preset = INDUSTRY_PRESETS.find((item) => item.id === settings?.industry) || INDUSTRY_PRESETS[0]
  return normalizeStageLabels(settings?.stageLabels, preset.stageLabels)[stage] || String(stage)
}

export const workspaceStageOptions = (settings, extraStages = []) => {
  const stages = [...new Set([...JOURNEY, ...extraStages.filter(Boolean)])]
  return stages.map((value) => ({ value, label: workspaceStageLabel(settings, value) }))
}

export const lowerFirst = (value) => value ? value.charAt(0).toLocaleLowerCase() + value.slice(1) : ''

export const customFieldKey = (label) => text(label, 80).toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)

export function normalizeWorkspace(settings = {}) {
  const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const customFields = []
  const seen = new Set()
  for (const field of Array.isArray(input.customFields) ? input.customFields.slice(0, 50) : []) {
    if (!field || typeof field !== 'object' || unsafeKeys.has(field.key)) continue
    const key = customFieldKey(field.key || field.label)
    const label = text(field.label, 80)
    if (!key || !label || unsafeKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    const type = fieldTypes.has(field.type) ? field.type : 'text'
    const normalized = { key, label, type }
    if (type === 'select') normalized.options = [...new Set((Array.isArray(field.options) ? field.options : [])
      .map((option) => text(option, 120)).filter(Boolean))].slice(0, 50)
    customFields.push(normalized)
  }
  const currency = text(input.currency, 3).toUpperCase()
  const countryCode = text(input.countryCode, 8).replace(/^\+/, '')
  const industry = INDUSTRY_PRESETS.some((preset) => preset.id === input.industry) ? input.industry : 'general'
  const preset = INDUSTRY_PRESETS.find((item) => item.id === industry) || INDUSTRY_PRESETS[0]
  return {
    name: text(input.name) || DEFAULT_WORKSPACE.name,
    industry,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_WORKSPACE.currency,
    countryCode: /^[1-9]\d{0,2}$/.test(countryCode) ? countryCode : DEFAULT_WORKSPACE.countryCode,
    website: text(input.website, 300),
    phone: text(input.phone, 40),
    city: text(input.city, 100),
    terminology: normalizeTerminology(input.terminology, preset.terminology),
    stageLabels: normalizeStageLabels(input.stageLabels, preset.stageLabels),
    customFields,
    setupComplete: input.setupComplete === true,
  }
}

export function readLocalWorkspace() {
  try {
    return normalizeWorkspace(JSON.parse(globalThis.localStorage?.getItem(WORKSPACE_STORAGE_KEY) || 'null'))
  } catch {
    return normalizeWorkspace()
  }
}

export function saveLocalWorkspace(settings) {
  const normalized = normalizeWorkspace(settings)
  if (!globalThis.localStorage) throw new Error('Browser storage is unavailable. Enable local storage to save your workspace.')
  globalThis.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}
