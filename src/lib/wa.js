// Preview templates for sample data only. Live templates come from your own registry.
const DEMO_WA_TEMPLATES = [
  { key: 'welcome', label: 'Welcome', vars: [], body: 'Hi {{name}}, thanks for getting in touch. Tell us what you are looking for and our team will help with the next step.' },
  { key: 'follow_up', label: 'Follow-up', vars: [], body: 'Hi {{name}}, would you like any more information about the options we discussed? Reply when it suits you.' },
  { key: 'meeting_reminder', label: 'Meeting reminder', vars: [{ key: 'datetime', label: 'Date and time', placeholder: '24 September, 2:30 PM' }, { key: 'host', label: 'Meeting host', placeholder: 'Alex' }], body: 'Hi {{name}}, your meeting with {{host}} is scheduled for {{datetime}}. Let us know if you need to reschedule.' },
  { key: 'proposal_ready', label: 'Proposal ready', vars: [], body: 'Hi {{name}}, your proposal is ready. We would be happy to walk you through it and answer your questions.' },
]
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || ''
const AUTO_VARIABLES = new Set(['name', 'first_name', 'lead_name'])

const componentBody = (components) => {
  const list = Array.isArray(components) ? components : []
  return list.find((component) => String(component?.type || '').toUpperCase() === 'BODY')?.text || ''
}

const schemaEntries = (schema) => {
  if (Array.isArray(schema)) return schema
  if (!schema || typeof schema !== 'object') return []
  const scoped = []
  for (const component of ['header', 'body', 'button', 'buttons']) {
    const source = schema[component]
    const values = Array.isArray(source) ? source : (Array.isArray(source?.parameters) ? source.parameters : [])
    for (const value of values) {
      scoped.push(typeof value === 'string'
        ? { key: value, component: component === 'buttons' ? 'button' : component }
        : { ...value, component: value?.component || (component === 'buttons' ? 'button' : component) })
    }
  }
  if (Array.isArray(schema.parameters)) scoped.push(...schema.parameters)
  if (scoped.length) return scoped
  return Object.entries(schema).map(([key, value]) => (
    value && typeof value === 'object' ? { key, ...value } : { key, label: String(value || key) }
  ))
}

const normalizeVariable = (variable, index) => {
  const source = typeof variable === 'string' ? { key: variable } : (variable || {})
  const key = String(source.key || source.name || source.local_name || `param_${index + 1}`)
  return {
    key,
    label: source.label || source.display_name || key.replaceAll('_', ' '),
    placeholder: source.placeholder || source.example || source.sample || '',
    position: Number(source.position || source.index || index + 1),
    required: source.required !== false,
    automatic: source.automatic === true || source.source === 'lead' || AUTO_VARIABLES.has(key.toLowerCase()),
    component: String(source.component || source.component_type || 'body').toLowerCase(),
    buttonIndex: Number(source.button_index ?? source.buttonIndex ?? 0),
    subType: String(source.sub_type || source.subType || '').toLowerCase() || null,
    parameterName: source.parameter_name || source.parameterName || null,
  }
}

export const normalizeWhatsappTemplate = (row) => {
  const vars = schemaEntries(row?.parameter_schema ?? row?.parameterSchema ?? row?.vars)
    .map(normalizeVariable)
    .sort((a, b) => a.position - b.position)
  return {
    ...row,
    key: row?.template_key || row?.key || row?.name || '',
    label: row?.display_name || row?.label || row?.name || row?.template_key || row?.key || '',
    language: row?.language || 'en_US',
    category: String(row?.category || 'utility').toLowerCase(),
    body: componentBody(row?.components) || row?.body || '',
    components: Array.isArray(row?.components) ? row.components : [],
    vars,
    status: String(row?.status || '').toUpperCase(),
    qualityStatus: row?.quality_status || row?.qualityStatus || null,
    rejectionReason: row?.rejection_reason || row?.rejectionReason || null,
    componentsSyncRequired: row?.components_sync_required === true || row?.componentsSyncRequired === true,
    syncedAt: row?.synced_at || row?.syncedAt || null,
  }
}

export const demoWhatsappTemplates = () => DEMO_WA_TEMPLATES.map((template) => normalizeWhatsappTemplate({
  ...template,
  template_key: template.key,
  name: template.label,
  provider: 'meta',
  language: 'en_US',
  status: 'APPROVED',
  parameter_schema: template.vars,
}))

export const whatsappTemplateInputVars = (template) =>
  (template?.vars || []).filter((variable) => !variable.automatic)

export const whatsappTemplateMediaType = (template) => {
  const header = (template?.components || []).find((component) =>
    String(component?.type || '').toUpperCase() === 'HEADER')
  const format = String(header?.format || '').toLowerCase()
  return ['image', 'video', 'document'].includes(format) ? format : ''
}

export const whatsappTemplateMissingVars = (template, values = {}) =>
  whatsappTemplateInputVars(template).filter((variable) =>
    variable.required && !String(values[variable.key] ?? '').trim())

export const whatsappTemplatePayloadVars = (template, leadName, values = {}) => {
  const resolved = { ...values, name: firstName(leadName) || 'there' }
  for (const variable of template?.vars || []) {
    if (variable.automatic && AUTO_VARIABLES.has(variable.key.toLowerCase())) {
      resolved[variable.key] = firstName(leadName) || 'there'
    }
  }
  return resolved
}

// Resolve a template's preview text for the CRM thread (variables filled in).
export const fillTemplate = (tpl, leadName, vars = {}) => {
  const values = whatsappTemplatePayloadVars(tpl, leadName, vars)
  const bodyVariables = (tpl?.vars || []).filter((variable) => variable.component === 'body')
  const byPosition = new Map((bodyVariables.length ? bodyVariables : (tpl?.vars || []))
    .map((variable) => [variable.position, variable]))
  return (tpl?.body || tpl?.label || '')
    .replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, (_match, key) => String(values[key] ?? '…'))
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, position) => {
      const variable = byPosition.get(Number(position))
      return String(variable ? (values[variable.key] ?? '…') : '…')
    })
}
