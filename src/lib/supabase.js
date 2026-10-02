import { createClient } from '@supabase/supabase-js'
import { normalizeConnection, readStoredConnection, connectionIdentity, selectedWorkspace } from './connections.js'

const envMode = ['supabase', 'saas'].includes(import.meta.env.VITE_CRM_MODE) ? import.meta.env.VITE_CRM_MODE : 'demo'
export const connectionsLocked = envMode !== 'demo' && import.meta.env.VITE_ALLOW_CONNECTION_SETUP !== 'true'
const input = (!connectionsLocked && readStoredConnection()) || {
  mode: envMode, supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '', workerUrl: import.meta.env.VITE_WORKER_URL || '',
}
let error = '', config
try { config = normalizeConnection(input, false) } catch (e) { error = e.message; config = { ...input, supabaseUrl: '', publicKey: '', workerUrl: '' } }
export const connectionConfig = Object.freeze(config)
export const configurationError = error
export const crmMode = config.mode
export const isSaas = crmMode === 'saas'
export const hasConfig = crmMode !== 'demo' && !error
export const workerUrl = hasConfig ? config.workerUrl : ''
const selection = selectedWorkspace()
export const activeWorkspaceId = isSaas && selection?.project === connectionIdentity(config) ? selection.id : null
export const tenantHeaders = () => {
  if (!isSaas) return {}
  if (!activeWorkspaceId) throw new Error('Choose a workspace before continuing.')
  return { 'x-workspace-id': activeWorkspaceId }
}
export const supabase = createClient(hasConfig ? config.supabaseUrl : 'http://localhost', hasConfig ? config.publicKey : 'demo-public-key', {
  global: { headers: isSaas && activeWorkspaceId ? { 'x-workspace-id': activeWorkspaceId } : {} },
  auth: { persistSession: hasConfig, autoRefreshToken: hasConfig, detectSessionInUrl: hasConfig,
    storageKey: `workspace-crm-auth-v2:${connectionIdentity(config)}` },
})
