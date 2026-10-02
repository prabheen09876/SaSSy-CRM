import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WORKSPACE, INDUSTRY_PRESETS, normalizeWorkspace, readLocalWorkspace, saveLocalWorkspace, WORKSPACE_STORAGE_KEY, workspaceTerminology, workspaceStageOptions, workspaceStageLabel } from '../src/lib/workspace.js'

test('missing or invalid workspace settings produce an unconfigured generic workspace', () => {
  for (const input of [undefined, null, [], 'old settings']) {
    assert.deepEqual(normalizeWorkspace(input), DEFAULT_WORKSPACE)
  }
  const settings = normalizeWorkspace({ industry: 'old_clinic', countryCode: 'invalid', customFields: 'invalid' })
  assert.equal(settings.industry, 'general')
  assert.equal(settings.setupComplete, false)
  assert.deepEqual(settings.customFields, [])
})

test('normalization preserves configured business details and stable custom field identifiers', () => {
  const settings = normalizeWorkspace({ name: '  Acme Studio  ', industry: 'services', currency: 'usd', countryCode: '+1', setupComplete: true,
    customFields: [{ key: 'contract_date', label: 'Renamed renewal date', type: 'date' },
      { key: 'service', label: 'Service', type: 'select', options: [' Design ', 'Design', '', 'Consulting'] }] })
  assert.equal(settings.name, 'Acme Studio')
  assert.equal(settings.currency, 'USD')
  assert.equal(settings.countryCode, '1')
  assert.equal(settings.customFields[0].key, 'contract_date')
  assert.deepEqual(settings.customFields[1].options, ['Design', 'Consulting'])
  assert.equal(settings.setupComplete, true)
})

test('invalid custom fields cannot create unsafe or duplicate metadata keys', () => {
  const fields = normalizeWorkspace({ customFields: [null, { key: '__proto__', label: 'Unsafe' },
    { key: 'constructor', label: 'Unsafe' }, { key: 'service name', label: 'Service' },
    { key: 'service_name', label: 'Duplicate' }, { key: 'blank', label: '' },
    { key: 'unknown_type', label: 'Notes', type: 'html' }] }).customFields
  assert.deepEqual(fields, [{ key: 'service_name', label: 'Service', type: 'text' }, { key: 'unknown_type', label: 'Notes', type: 'text' }])
})

test('industry presets are independent copies without mandatory medical fields', () => {
  for (const preset of INDUSTRY_PRESETS) {
    const fields = normalizeWorkspace({ customFields: preset.customFields }).customFields
    assert.deepEqual(fields, preset.customFields)
    if (fields.length) fields[0].label = 'Changed'
    assert.notEqual(preset.customFields[0]?.label, 'Changed')
    assert.ok(!preset.customFields.some((field) => /pcos|hormone|menstrual|fertility/i.test(field.label)))
  }
})

test('workspace settings round trip through local storage and malformed data is recoverable', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const entries = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } })
  try {
    const saved = saveLocalWorkspace({ name: 'Acme', setupComplete: true, customFields: [{ key: 'budget', label: 'Budget', type: 'number' }] })
    assert.deepEqual(readLocalWorkspace(), saved)
    entries.set(WORKSPACE_STORAGE_KEY, 'broken JSON')
    assert.deepEqual(readLocalWorkspace(), DEFAULT_WORKSPACE)
    globalThis.localStorage.setItem = () => { throw new Error('Storage full') }
    assert.throws(() => saveLocalWorkspace(saved), /Storage full/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('existing industry workspaces receive useful language defaults without changing stage values', () => {
  const workspace = normalizeWorkspace({ industry: 'education', setupComplete: true })
  const terms = workspaceTerminology(workspace)
  assert.equal(terms.recordPlural, 'Enquiries')
  assert.equal(terms.opportunities, 'enrolments')
  assert.equal(workspaceStageLabel(workspace, 'Closed Won'), 'Enrolled')
  assert.equal(workspaceStageOptions(workspace).find((stage) => stage.label === 'Enrolled').value, 'Closed Won')
  assert.equal(workspaceStageLabel(workspace, 'Historic stage'), 'Historic stage')
  assert.ok(workspaceStageOptions(workspace, ['Historic stage', 'Closed Won']).some((stage) => stage.value === 'Historic stage'))
})

test('custom vocabulary and stage labels persist independently of their industry preset', () => {
  const workspace = normalizeWorkspace({ industry: 'education', terminology: { recordSingular: ' Applicant ', recordPlural: ' Applicants ' }, stageLabels: { 'Closed Won': 'Admitted', 'Closed Lost': '' } })
  assert.equal(workspace.terminology.recordSingular, 'Applicant')
  assert.equal(workspace.terminology.recordPlural, 'Applicants')
  assert.equal(workspace.terminology.opportunityPlural, 'Enrolments')
  assert.equal(workspace.stageLabels['Closed Won'], 'Admitted')
  assert.equal(workspace.stageLabels['Closed Lost'], 'Not enrolled')
  workspace.stageLabels['Closed Won'] = 'Changed'
  workspace.terminology.recordPlural = 'Changed'
  assert.equal(INDUSTRY_PRESETS.find((preset) => preset.id === 'education').stageLabels['Closed Won'], 'Enrolled')
  assert.equal(INDUSTRY_PRESETS.find((preset) => preset.id === 'education').terminology.recordPlural, 'Enquiries')
})
