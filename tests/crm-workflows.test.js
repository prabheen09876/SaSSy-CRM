import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLeadExportRows, inferImportTarget, mapImportRow } from '../src/lib/xlsx.js'
import { scoreLead } from '../src/lib/ai.js'

const workspace = {
  currency: 'EUR',
  customFields: [
    { key: 'seats', label: 'Team size', type: 'number' },
    { key: 'launch', label: 'Launch date', type: 'date' },
    { key: 'plan', label: 'Plan', type: 'select', options: ['Standard', 'Premium'] },
  ],
}

test('business and custom fields survive spreadsheet export/import, including a hidden field', () => {
  const source = {
    name: 'Maya Chen', phone: '+12025550101', email: 'maya@example.com',
    company: 'Studio Example', jobTitle: 'Founder', city: 'Madrid', website: 'https://example.com',
    interest: 'Annual service plan', budget: 12500.50, currency: 'EUR', expectedCloseDate: '2026-10-01',
    sourceChannel: 'referral', leadType: 'sales', qualStatus: 'Qualified', journeyStatus: 'Proposal Sent',
    score: '75', priority: 'High', followupDate: '2026-09-20', followupTime: '14:30',
    remarks: '=a harmless note', customFields: { seats: 20, launch: '2026-10-15', plan: 'Premium', retired: 'Keep this value' },
    dob: '1990-01-01', medPcos: 'Yes',
  }
  const [exported] = buildLeadExportRows([source], [], workspace)
  assert.equal(exported['Phone'], "'+12025550101")
  assert.equal(exported['Remarks'], "'=a harmless note")
  assert.equal(exported['Opportunity Value'], 12500.50)
  assert.ok(!Object.hasOwn(exported, 'Date of Birth'))
  const mapping = Object.fromEntries(Object.keys(exported).map((key) => [key, inferImportTarget(key, workspace.customFields)]))
  const imported = mapImportRow(exported, mapping, workspace)
  for (const key of ['name', 'phone', 'email', 'company', 'jobTitle', 'city', 'website', 'interest', 'budget', 'currency', 'expectedCloseDate', 'sourceChannel', 'leadType', 'qualStatus', 'journeyStatus', 'priority', 'followupDate', 'followupTime', 'remarks']) {
    assert.equal(imported[key], source[key], key)
  }
  assert.deepEqual(imported.customFields, source.customFields)
  assert.ok(!Object.hasOwn(imported, 'dob'))
})

test('ambiguous organization names do not become contact names and a missing name skips the row', () => {
  assert.equal(inferImportTarget('Company Name'), 'company')
  assert.equal(inferImportTarget('Contact Name'), 'name')
  assert.equal(inferImportTarget('Source Channel'), 'sourceChannel')
  assert.equal(inferImportTarget('Displayed Type'), '')
  assert.equal(mapImportRow({ Company: 'Acme' }, { Company: 'company' }), null)
})

test('customized stage exports retain canonical outcomes and skip the display column on re-import', () => {
  const settings = {
    ...workspace,
    stageLabels: { 'Closed Won': 'Enrolled', 'Closed Lost': 'Not enrolled' },
    customFields: [...workspace.customFields, { key: 'stage_label', label: 'Stage Label', type: 'text' }],
  }
  for (const [stage, label, score] of [['Closed Won', 'Enrolled', 100], ['Closed Lost', 'Not enrolled', 0]]) {
    const [exported] = buildLeadExportRows([{ name: 'Maya', journeyStatus: stage, customFields: { stage_label: 'Separate custom value' } }], [], settings)
    assert.equal(exported.Stage, stage)
    assert.equal(exported['Stage Label'], label)
    const mapping = Object.fromEntries(Object.keys(exported).map((header) => [header, inferImportTarget(header, settings.customFields)]))
    assert.equal(mapping.Stage, 'journeyStatus')
    assert.equal(mapping['Stage Label'], '')
    assert.equal(mapping['Custom: Stage Label [stage_label]'], 'custom:stage_label')
    const imported = mapImportRow(exported, mapping, settings)
    assert.equal(imported.journeyStatus, stage)
    assert.equal(imported.customFields.stage_label, 'Separate custom value')
    assert.equal(scoreLead(imported).score, score)
  }
})

test('custom fields named Name and Stage round-trip without replacing record identity or outcome', () => {
  const settings = {
    ...workspace,
    stageLabels: { 'Closed Won': 'Enrolled', 'Closed Lost': 'Not enrolled' },
    customFields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'text' },
      { key: 'created', label: 'Created', type: 'text' },
      { key: 'seats', label: 'Team size', type: 'number' },
    ],
  }
  const source = [
    { name: 'Maya', journeyStatus: 'Closed Won', createdAt: '2026-09-01T00:00:00Z', customFields: { name: 'Project Orion', stage: 'In delivery', created: 'Client supplied value', seats: 12 } },
    { name: 'Ravi', journeyStatus: 'Closed Lost', createdAt: '2026-09-02T00:00:00Z', customFields: { name: 'Project Atlas', stage: 'On hold', created: 'Another custom value', seats: 8 } },
  ]
  const exported = buildLeadExportRows(source, [], settings)
  const mapping = Object.fromEntries(Object.keys(exported[0]).map((header) => [header, inferImportTarget(header, settings.customFields)]))
  assert.equal(mapping.Name, 'name')
  assert.equal(mapping.Stage, 'journeyStatus')
  assert.equal(mapping.Created, '')
  assert.equal(mapping['Custom: Name [name]'], 'custom:name')
  assert.equal(mapping['Custom: Stage [stage]'], 'custom:stage')
  assert.equal(mapping['Custom: Created [created]'], 'custom:created')
  assert.equal(inferImportTarget('Team size', settings.customFields), 'custom:seats')
  for (let index = 0; index < source.length; index++) {
    const imported = mapImportRow(exported[index], mapping, settings)
    assert.equal(imported.name, source[index].name)
    assert.equal(imported.journeyStatus, source[index].journeyStatus)
    assert.deepEqual(imported.customFields, source[index].customFields)
    assert.equal(scoreLead(imported).score, index === 0 ? 100 : 0)
  }
})

test('configured stage aliases import case-insensitively while preserving won and lost outcomes', () => {
  const settings = { stageLabels: { 'Closed Won': 'Enrolled', 'Closed Lost': 'Not enrolled' } }
  const mapping = { Name: 'name', Stage: 'journeyStatus' }
  const won = mapImportRow({ Name: 'Maya', Stage: '  ENROLLED  ' }, mapping, settings)
  const lost = mapImportRow({ Name: 'Maya', Stage: 'not enrolled' }, mapping, settings)
  assert.equal(won.journeyStatus, 'Closed Won')
  assert.equal(lost.journeyStatus, 'Closed Lost')
  assert.equal(scoreLead(won).score, 100)
  assert.equal(scoreLead(lost).score, 0)
  assert.throws(() => mapImportRow({ Name: 'Maya', Stage: 'Unconfigured' }, mapping, settings), /not recognized/)
})

test('ambiguous stage aliases are rejected and canonical values remain authoritative', () => {
  const mapping = { Name: 'name', Stage: 'journeyStatus' }
  const ambiguous = { stageLabels: { 'Closed Won': 'Finished', 'Closed Lost': 'finished' } }
  assert.throws(() => mapImportRow({ Name: 'Maya', Stage: 'FINISHED' }, mapping, ambiguous), /ambiguous.*Closed Won, Closed Lost/)
  const collision = { stageLabels: { 'Closed Lost': 'Closed Won' } }
  const imported = mapImportRow({ Name: 'Maya', Stage: 'Closed Won' }, mapping, collision)
  assert.equal(imported.journeyStatus, 'Closed Won')
  assert.equal(scoreLead(imported).score, 100)
})

test('import validation messages use configured record and opportunity terminology', () => {
  const settings = { terminology: { recordSingular: 'Buyer', opportunitySingular: 'Deal' } }
  const mapping = { Name: 'name', Value: 'budget', Score: 'score', Category: 'leadType' }
  assert.throws(() => mapImportRow({ Name: 'Maya', Value: '-1' }, mapping, settings), /Deal value/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Score: '101' }, mapping, settings), /Buyer score/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Category: 'Unknown' }, mapping, settings), /Buyer category/)
})

test('imports validate amounts, dates and configured choices before writing', () => {
  const mapping = { Name: 'name', Value: 'budget', Date: 'expectedCloseDate', Plan: 'custom:plan' }
  assert.equal(mapImportRow({ Name: 'Maya', Value: '12,500.50' }, mapping, workspace).budget, 12500.5)
  assert.throws(() => mapImportRow({ Name: 'Maya', Value: '-1' }, mapping, workspace), /Opportunity value/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Value: '1,5' }, mapping, workspace), /Opportunity value/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Date: '2026-02-30' }, mapping, workspace), /valid date/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Date: '09\/10\/2026' }, mapping, workspace), /YYYY-MM-DD/)
  assert.throws(() => mapImportRow({ Name: 'Maya', Plan: 'Unknown' }, mapping, workspace), /not recognized/)
  assert.equal(mapImportRow({ Name: 'Maya', Plan: 'premium' }, mapping, workspace).customFields.plan, 'Premium')
})

test('import refuses prototype keys and never infers communication consent', () => {
  assert.throws(() => mapImportRow({ Name: 'Maya', Unsafe: 'x' }, { Name: 'name', Unsafe: 'custom:__proto__' }), /Invalid custom field/)
  const result = mapImportRow({ Name: 'Maya', Consent: 'true' }, { Name: 'name', Consent: 'consentWhatsapp' })
  assert.ok(!Object.hasOwn(result, 'consentWhatsapp'))
})

test('phone imports use the workspace country without granting consent and preserve non-deliverable values', () => {
  const mapping = { Name: 'name', Phone: 'phone', Consent: 'consentWhatsapp' }
  const cases = [
    ['2025550181', '1', '+12025550181'],
    ['7290007215', '1', '+17290007215'],
    ['020 7946 0958', '44', '+442079460958'],
    ['+12025550181', '44', '+12025550181'],
    ['0044 20 7946 0958', '1', '+442079460958'],
    ['12345', '1', '12345'],
    ['020 7946 0958 ext 2', '44', '020 7946 0958 ext 2'],
  ]
  for (const [phone, countryCode, expected] of cases) {
    const imported = mapImportRow({ Name: 'Maya', Phone: phone, Consent: 'true' }, mapping, { countryCode })
    assert.equal(imported.phone, expected)
    assert.ok(!Object.hasOwn(imported, 'consentWhatsapp'))
  }
})

test('scoring is industry-neutral and explains commercial evidence', () => {
  const contact = { name: 'Maya', email: 'maya@example.com', qualStatus: 'Qualified', interest: 'Service plan', budget: 500, expectedCloseDate: '2026-09-30', journeyStatus: 'Proposal Sent' }
  const result = scoreLead(contact, '2026-09-17T00:00:00Z')
  assert.equal(result.score, 100)
  assert.match(result.summary, /Rule-based/)
  assert.match(result.summary, /value recorded/)
  assert.match(result.summary, /closing within 30 days/)
  const irrelevant = { ...contact, medPcos: 'Yes', medCity: 'Delhi', freezeDate: 'Within 6 months', dob: '1990-01-01' }
  assert.deepEqual(scoreLead(irrelevant, '2026-09-17T00:00:00Z'), result)
})

test('closed and uninterested leads receive appropriate follow-up guidance', () => {
  assert.equal(scoreLead({ journeyStatus: 'Closed Won' }).score, 100)
  assert.equal(scoreLead({ journeyStatus: 'Closed Lost' }).score, 0)
  assert.match(scoreLead({ journeyStatus: 'Not Interested' }).summary, /only if invited/)
  assert.equal(scoreLead({ qualStatus: 'Unqualified', journeyStatus: 'Unresponsive' }).score, 0)
})
