// SheetJS is ~400KB — load it on demand (import/export), not on first paint.
import { displayLeadTypeLabel, leadTypeLabel, JOURNEY, QUAL, LEAD_TYPES_FALLBACK, SOURCE_CHANNELS, PRIORITIES } from './constants.js'
import { workspaceStageLabel, workspaceTerminology } from './workspace.js'
import { normalizeRecordPhone } from './whatsappSafety.js'

let _xlsx
const getXLSX = () => (_xlsx ||= import('xlsx'))

export const IMPORT_TARGETS = [
  { v: '', l: 'Skip' }, { v: 'name', l: 'Name' }, { v: 'phone', l: 'Phone' },
  { v: 'email', l: 'Email' }, { v: 'company', l: 'Company / organization' },
  { v: 'jobTitle', l: 'Job title / role' }, { v: 'city', l: 'City / location' },
  { v: 'website', l: 'Website' }, { v: 'interest', l: 'Product / service interest' },
  { v: 'budget', l: 'Opportunity value' }, { v: 'currency', l: 'Currency' },
  { v: 'expectedCloseDate', l: 'Expected close date' }, { v: 'source', l: 'Source' },
  { v: 'sourceChannel', l: 'Source channel' }, { v: 'leadType', l: 'Lead type' },
  { v: 'qualStatus', l: 'Qualification' }, { v: 'journeyStatus', l: 'Stage' },
  { v: 'score', l: 'Lead score' }, { v: 'priority', l: 'Priority' },
  { v: 'remarks', l: 'Remarks' }, { v: 'followupDate', l: 'Follow-up date' },
  { v: 'followupTime', l: 'Follow-up time' },
]
const normalHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const customExportHeader = (key, definitions = []) => {
  const label = definitions.find((field) => field.key === key)?.label || key
  return `Custom: ${label} [${key}]`
}
export function inferImportTarget(header, definitions = []) {
  const raw = String(header || '').trim()
  const customKey = /^Custom: .*\[([^\]]+)\]$/.exec(raw)?.[1]
  if (customKey && !['__proto__', 'constructor', 'prototype'].includes(customKey)) return `custom:${customKey}`
  const normalized = normalHeader(raw)
  // Export metadata is display-only. Explicit Custom headers above still preserve
  // custom fields that reuse these names without importing the metadata into them.
  if (['stagelabel', 'displayedtype', 'activitylogmessages', 'created'].includes(normalized)) return ''
  const exact = IMPORT_TARGETS.find(({ v, l }) => v && (normalHeader(v) === normalized || normalHeader(l) === normalized))
  if (exact) return exact.v
  // Canonical columns must win over bare custom aliases to preserve identity and
  // stage when importing our own exports. Custom columns carry their explicit key.
  const custom = definitions.find((field) => normalHeader(field.label) === normalized || normalHeader(field.key) === normalized)
  if (custom) return `custom:${custom.key}`
  const aliases = {
    fullname: 'name', contactname: 'name', firstname: 'name', mobile: 'phone', mobilenumber: 'phone', phonenumber: 'phone',
    organization: 'company', organisation: 'company', companyname: 'company', organizationname: 'company',
    title: 'jobTitle', role: 'jobTitle', location: 'city', product: 'interest', service: 'interest', requirement: 'interest',
    value: 'budget', dealvalue: 'budget', estimatedvalue: 'budget', closedate: 'expectedCloseDate',
    qualificationstatus: 'qualStatus', pipelinestage: 'journeyStatus', journeystage: 'journeyStatus',
    notes: 'remarks', note: 'remarks', followup: 'followupDate', category: 'leadType',
  }
  return aliases[normalized] || ''
}

const numericValue = (value, label, { minimum = -Infinity, maximum = Infinity } = {}) => {
  const normalized = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value) ? value.replace(/,/g, '') : value
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} must be a number${minimum === 0 ? ' of zero or more' : ''}${maximum < Infinity ? `, at most ${maximum}` : ''}.`)
  return number
}
const dateValue = (value, label) => {
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid date in YYYY-MM-DD format.`)
  }
  return value
}
const enumValue = (value, options, label) => {
  const match = options.find((option) => String(option).toLowerCase() === value.toLowerCase())
  if (!match) throw new Error(`${label} “${value}” is not recognized. Adjust this value or skip the column.`)
  return match
}

const stageValue = (value, workspace) => {
  const normalized = value.toLowerCase()
  // Preserve canonical exports even when a custom label reuses another stage's
  // stored name. Renaming a stage must never change the outcome of a round-trip.
  const canonical = JOURNEY.find((stage) => stage.toLowerCase() === normalized)
  if (canonical) return canonical
  const matches = JOURNEY.filter((stage) => workspaceStageLabel(workspace, stage).toLowerCase() === normalized)
  if (matches.length > 1) {
    throw new Error(`Stage label “${value}” is ambiguous. Use one of these canonical Stage values: ${matches.join(', ')}.`)
  }
  if (matches.length === 1) return matches[0]
  throw new Error(`Stage “${value}” is not recognized. Use a configured stage label or a canonical Stage value, or skip the column.`)
}

// Validate every row before beginning writes so a bad amount/date cannot create
// half an import. Explicit names are required; unrelated columns never become names.
export function mapImportRow(row, mapping, workspace = {}) {
  const { customFields = [], leadTypes = [], currency = 'USD' } = workspace
  const terms = workspaceTerminology(workspace)
  const fields = { customFields: {} }
  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue
    const raw = String(row[header] ?? '').trim()
    // Remove only the escaping added by safeCell during our own spreadsheet export.
    const value = /^'[=+\-@\t\r]/.test(raw) ? raw.slice(1) : raw
    if (!value) continue
    if (target.startsWith('custom:')) {
      const key = target.slice(7)
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid custom field key.')
      const definition = customFields.find((field) => field.key === key)
      let parsed = value
      if (definition?.type === 'number') parsed = numericValue(value, definition.label)
      if (definition?.type === 'date') parsed = dateValue(value, definition.label)
      if (definition?.type === 'select') parsed = enumValue(value, definition.options || [], definition.label)
      fields.customFields[key] = parsed
    } else if (IMPORT_TARGETS.some(({ v }) => v === target)) fields[target] = value
  }
  if (!fields.name) return null
  if (fields.budget != null) fields.budget = numericValue(fields.budget, `${terms.opportunitySingular} value`, { minimum: 0 })
  if (fields.score != null) fields.score = numericValue(fields.score, `${terms.recordSingular} score`, { minimum: 0, maximum: 100 })
  for (const key of ['expectedCloseDate', 'followupDate']) if (fields[key]) fields[key] = dateValue(fields[key], key === 'expectedCloseDate' ? 'Expected close date' : 'Follow-up date')
  if (fields.followupTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.followupTime)) throw new Error('Follow-up time must use HH:MM (24-hour time).')
  if (fields.qualStatus) fields.qualStatus = enumValue(fields.qualStatus, QUAL, 'Qualification')
  if (fields.journeyStatus) fields.journeyStatus = stageValue(fields.journeyStatus, workspace)
  if (fields.priority) fields.priority = enumValue(fields.priority, PRIORITIES, 'Priority')
  if (fields.leadType) {
    const type = (leadTypes.length ? leadTypes : LEAD_TYPES_FALLBACK).find((item) => [item.key, item.label].some((value) => value.toLowerCase() === fields.leadType.toLowerCase()))
    if (!type) throw new Error(`${terms.recordSingular} category “${fields.leadType}” is not configured in this workspace.`)
    fields.leadType = type.key
  }
  if (fields.sourceChannel) {
    const source = SOURCE_CHANNELS.find(({ v, l }) => [v, l].some((value) => value.toLowerCase() === fields.sourceChannel.toLowerCase()))
    if (!source) throw new Error(`Source channel “${fields.sourceChannel}” is not recognized.`)
    fields.sourceChannel = source.v
  }
  fields.currency = String(fields.currency || currency).toUpperCase()
  if (!/^[A-Z]{3}$/.test(fields.currency)) throw new Error('Currency must use a three-letter code, such as USD, EUR or INR.')
  return normalizeRecordPhone(fields, workspace.countryCode)
}

// Prevent user-entered names/notes from being interpreted as formulas by Excel.
const safeCell = (value) => {
  const text = value == null ? '' : String(value)
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

const activityTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? safeCell(value) : date.toISOString()
}

const activityLine = (activity) => {
  const meta = [
    activityTime(activity?.at),
    safeCell(activity?.type || 'Activity'),
    safeCell(activity?.actor_name || ''),
  ].filter(Boolean).join(' | ')
  const notes = safeCell(activity?.notes || '')
  return notes ? `${meta}${meta ? ' - ' : ''}${notes}` : meta
}

// Friendly export of leads to a downloadable .xlsx. Keeps headers human-readable
// so the team can open it in Excel / Google Sheets without translation.
export function buildLeadExportRows(leads, leadTypes = [], workspace = {}) {
  const customKeys = [...new Set([...(workspace.customFields || []).map((field) => field.key), ...leads.flatMap((lead) => Object.keys(lead.customFields || {}))])]
  return leads.map((l) => {
    const activities = [...(l.activities || [])].sort((a, b) =>
      (Date.parse(b?.at || '') || 0) - (Date.parse(a?.at || '') || 0))
    // Excel cells have a 32,767 character limit. The complete, untruncated log
    // is also written one entry per row in the Activity Log sheet below.
    const activitySummary = activities.map(activityLine).filter(Boolean).join('\n').slice(0, 32000)
    return {
      'Name': safeCell(l.name),
      'Phone': safeCell(l.phone),
      'Email': safeCell(l.email),
      'Company': safeCell(l.company),
      'Job Title': safeCell(l.jobTitle),
      'City': safeCell(l.city),
      'Website': safeCell(l.website),
      'Product / Service Interest': safeCell(l.interest),
      'Opportunity Value': l.budget === '' || l.budget == null ? '' : Number(l.budget),
      'Currency': safeCell(l.currency || workspace.currency || 'USD'),
      'Expected Close Date': safeCell(l.expectedCloseDate),
      'Source': safeCell(l.source),
      'Source Channel': safeCell(l.sourceChannel),
      'Displayed Type': safeCell(displayLeadTypeLabel(l, leadTypes)),
      'Lead Type': safeCell(l.leadType ? leadTypeLabel(l.leadType, leadTypes) : ''),
      'Qualification': safeCell(l.qualStatus),
      'Stage': safeCell(l.journeyStatus),
      'Stage Label': safeCell(workspaceStageLabel(workspace, l.journeyStatus)),
      'Lead Score': safeCell(l.score),
      'Follow-up Date': safeCell(l.followupDate),
      'Follow-up Time': safeCell(l.followupTime),
      'Priority': safeCell(l.priority),
      'Remarks': safeCell(l.remarks),
      'Activity Log Messages': activitySummary,
      'Created': safeCell(l.createdAt),
      ...Object.fromEntries(customKeys.map((key) => [customExportHeader(key, workspace.customFields), safeCell(l.customFields?.[key])])),
    }
  })
}

export async function exportLeads(leads, leadTypes = [], workspace = {}) {
  if (!leads || !leads.length) return false
  const XLSX = await getXLSX()
  const rows = buildLeadExportRows(leads, leadTypes, workspace)

  const activityRows = leads.flatMap((lead) =>
    [...(lead.activities || [])]
      .sort((a, b) => (Date.parse(b?.at || '') || 0) - (Date.parse(a?.at || '') || 0))
      .map((activity) => ({
        'Lead Name': safeCell(lead.name),
        'Lead Phone': safeCell(lead.phone),
        'Activity Date': activityTime(activity.at),
        'Type': safeCell(activity.type),
        'Message / Notes': safeCell(activity.notes),
        'Added By': safeCell(activity.actor_name),
      })))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0]).map((header) => ({ wch: /Remarks|Messages/.test(header) ? 65 : /Email|Interest|Website/.test(header) ? 30 : 22 }))
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }

  const activityHeaders = ['Lead Name', 'Lead Phone', 'Activity Date', 'Type', 'Message / Notes', 'Added By']
  const activityWs = XLSX.utils.json_to_sheet(activityRows, { header: activityHeaders })
  activityWs['!cols'] = [
    { wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 80 }, { wch: 24 },
  ]
  if (activityWs['!ref']) activityWs['!autofilter'] = { ref: activityWs['!ref'] }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')
  XLSX.utils.book_append_sheet(wb, activityWs, 'Activity Log')

  const today = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `crm_leads_${today}.xlsx`)
  return true
}

// Parse an uploaded .csv / .xlsx / .xls into { headers, rows }.
// raw:false keeps everything as readable strings; defval:'' avoids undefined cells.
export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided'))
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.onload = async (e) => {
      try {
        const XLSX = await getXLSX()
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        const headers = Object.keys(rows[0] || {})
        resolve({ headers, rows })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}
