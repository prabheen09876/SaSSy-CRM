// Persist public endpoints only. Private service keys never belong in a browser.
export const CONNECTION_KEY = 'workspace-crm.connection.v1'
export const WORKSPACE_SELECTION_KEY = 'workspace-crm.selected-workspace.v1'
export const INVITATION_KEY = 'workspace-crm.pending-invitation.v1'
export const ACCOUNT_SETUP_KEY = 'workspace-crm.account-setup.v1'
export const validInvitationToken = (token) => typeof token === 'string' && /^[a-z0-9-]{32,200}$/i.test(token)
export function pendingInvitation(project, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(INVITATION_KEY) || 'null')
    return value?.project === project && validInvitationToken(value.token) ? value.token : ''
  } catch { return '' }
}

export function connectionUrl(value, label = 'URL', optional = false) {
  const raw = String(value || '').trim()
  if (!raw && optional) return ''
  let url
  try { url = new URL(raw) } catch { throw new Error(`Enter a valid ${label}.`) }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error(`${label} must use HTTPS (HTTP is allowed only on localhost).`)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${label} must be a base URL without passwords, paths, or query parameters.`)
  return url.origin
}

export function validatePublicKey(value, strict = true) {
  const key = String(value || '').trim()
  if (!key || key.length > 8192 || /\s/.test(key)) throw new Error('Enter the Supabase publishable key, not a private key.')
  if (key.startsWith('sb_secret_')) throw new Error('Secret keys cannot be used here. Copy the publishable key instead.')
  if (key.split('.').length === 3) {
    let claims
    try { claims = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { throw new Error('This Supabase key is not valid.') }
    if (claims.role !== 'anon') throw new Error('Only an anon or publishable key is allowed. Never enter a service-role key.')
  } else if (strict && !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) {
    throw new Error('Use a Supabase publishable key or the legacy anon key.')
  }
  return key
}

export function normalizeConnection(value, strict = true) {
  const mode = value?.mode
  if (!['demo', 'supabase', 'saas'].includes(mode)) throw new Error('Choose demo, standalone, or SaaS mode.')
  if (mode === 'demo') return { mode, supabaseUrl: '', publicKey: '', workerUrl: '' }
  return { mode, supabaseUrl: connectionUrl(value.supabaseUrl, 'Supabase project URL'),
    publicKey: validatePublicKey(value.publicKey, strict), workerUrl: connectionUrl(value.workerUrl, 'Cloudflare service URL', true) }
}

export const connectionIdentity = (config) => encodeURIComponent(config.supabaseUrl || 'demo')

// A one-time handoff from connecting infrastructure to creating an account.
// Scope it to the project so another database never inherits this setup state.
export function accountSetupPending(config, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(ACCOUNT_SETUP_KEY) || 'null')
    return config.mode === 'saas' && value?.project === connectionIdentity(config)
  } catch { return false }
}

export function readStoredConnection(storage = globalThis.localStorage) {
  try { const raw = storage?.getItem(CONNECTION_KEY); return raw ? normalizeConnection(JSON.parse(raw)) : null } catch { return null }
}

export function selectedWorkspace(storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(WORKSPACE_SELECTION_KEY) || 'null')
    return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) ? value : null
  } catch { return null }
}

export async function checkConnection(draft, fetcher = fetch) {
  const config = normalizeConnection(draft)
  if (config.mode === 'demo') return { database: 'demo', gateway: 'not configured' }
  // Never forward the current session to a newly entered server. Redirects
  // must not carry even a public API key to an unexpected host.
  const response = await fetcher(`${config.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.publicKey }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Database connection failed. Check the project URL and publishable key.')
  const schema = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/crm_schema_info`, {
    method: 'POST', headers: { apikey: config.publicKey, 'content-type': 'application/json' }, body: '{}',
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  const info = await schema.json().catch(() => null)
  if (schema.ok && ['saas', 'supabase'].includes(info?.mode) && info.mode !== config.mode) {
    throw new Error(`This database is set up for ${info.mode === 'saas' ? 'SaaS workspaces. Choose SaaS' : 'one standalone business. Choose Standalone'} under Installation type. Do not install another schema over it.`)
  }
  if (!schema.ok || info?.mode !== config.mode || info?.version !== 1) {
    const label = config.mode === 'saas' ? 'SaaS' : 'standalone'
    throw new Error(`Supabase is reachable, but the ${label} CRM schema is missing or incompatible. For a new, empty database, run supabase/${config.mode === 'saas' ? 'saas' : 'standalone'}.sql first. Do not run it over an existing installation.`)
  }
  let gateway = 'not configured'
  if (config.workerUrl) {
    const response = await fetcher(`${config.workerUrl}/public/health`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) })
    const info = await response.json().catch(() => null)
    if (!response.ok || info?.service !== 'workspace-crm' || info?.version !== 1 || info?.ok !== true) throw new Error('The Cloudflare URL did not return the CRM gateway health check. Deploy the included gateway and allow this app’s origin.')
    gateway = 'reachable'
  }
  return { database: 'reachable', gateway }
}
