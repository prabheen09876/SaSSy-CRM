// Roles, permissions, and the demo personas.
// One place that answers "who can do what" — every screen asks can(me, '…')
// instead of hard-checking role strings, so the hierarchy stays consistent.

export const ALL_ROLES = ['admin', 'sub-admin', 'coordinator', 'reception', 'marketing']

export const ROLE_META = {
  admin:       { label: 'Owner',       short: 'Owner',      pill: 'success' },
  'sub-admin': { label: 'Manager',     short: 'Manager',    pill: 'info' },
  coordinator: { label: 'Sales',       short: 'Sales',      pill: 'warning' },
  reception:   { label: 'Support',     short: 'Support',    pill: 'neutral' },
  marketing:   { label: 'Marketing',   short: 'Marketing',  pill: 'neutral' },
}
export const roleLabel = (r) => ROLE_META[r]?.label || r || '—'
export const roleShort = (r) => ROLE_META[r]?.short || roleLabel(r)
export const rolePill  = (r) => ROLE_META[r]?.pill || 'neutral'

// permission sets per role. 'admin' gets the wildcard.
const PERMS = {
  admin: ['*'],
  'sub-admin': [
    'leads.view', 'leads.add', 'leads.edit', 'leads.delete', 'leads.export',
    'reminders.view', 'calendar.view',
    'automations.view', 'automations.edit', 'templates.edit',
    'messages.view', 'messages.send', 'messages.optOut', 'messages.recordConsent', 'analytics.view',
    'team.view', 'team.manage', 'settings.view', 'settings.edit', 'intake.manage',
    'leadtypes.manage', 'account.view',
  ],
  coordinator: [
    'leads.view', 'leads.add', 'leads.edit',
    'reminders.view', 'calendar.view', 'automations.view',
    'messages.view', 'messages.send', 'analytics.view',
    'account.view',
  ],
  reception: [
    'leads.view', 'leads.add', 'leads.edit',
    'reminders.view', 'calendar.view', 'messages.view', 'messages.send',
    'account.view',
  ],
  marketing: [
    'leads.view', 'leads.add', 'leads.edit', 'analytics.view', 'intake.manage',
    'automations.view', 'templates.edit', 'messages.view',
    'account.view',
  ],
}

export function can(me, perm) {
  if (!me || !me.role || me.active === false || me.password_change_required === true) return false
  const set = PERMS[me.role]
  if (!set) return false
  return set.includes('*') || set.includes(perm)
}

// which roles a given user is allowed to assign when adding/editing staff.
// Managers cannot manage other managers or owners.
export function assignableRoles(me) {
  if (!can(me, 'team.manage')) return []
  if (me.role === 'admin') return ALL_ROLES
  return ALL_ROLES.filter((r) => !['admin', 'sub-admin'].includes(r))
}

// can `me` edit/deactivate this specific person?
export function canManagePerson(me, target) {
  if (!can(me, 'team.manage') || !target || me.id === target.id) return false
  if (me?.role === 'admin') return true
  return !['admin', 'sub-admin'].includes(target.role)
}

// Demo personas shown on the login screen so the hierarchy is explorable
// with no backend. Each id maps to a profile in the in-memory demo backend.
export const DEMO_PERSONAS = [
  { id: 'p-admin',   role: 'admin',       name: 'Alex Morgan', title: 'Workspace owner', blurb: 'Manage your team, settings, workflows, and every lead.' },
  { id: 'p-manager', role: 'sub-admin',   name: 'Sam Rivera', title: 'Manager', blurb: 'Manage day-to-day operations, team members, and the sales pipeline.' },
  { id: 'p-satyam',  role: 'coordinator', name: 'Jordan Lee', title: 'Sales', blurb: 'Work leads from first conversation to proposal and close.' },
  { id: 'p-recep',   role: 'reception',   name: 'Taylor Kim', title: 'Support', blurb: 'Capture enquiries, arrange meetings, and follow up with customers.' },
  { id: 'p-mktg',    role: 'marketing',   name: 'Avery Patel', title: 'Marketing', blurb: 'Manage campaigns, lead sources, templates, and analytics.' },
]
