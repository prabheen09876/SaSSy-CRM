import { supabase, activeWorkspaceId, connectionConfig, isSaas } from './supabase.js'
import { WORKSPACE_SELECTION_KEY, connectionIdentity } from './connections.js'

async function rpc(name, args) {
  if (!isSaas) throw new Error('Connect a SaaS database to use workspaces and invitations.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message || 'The workspace request could not be completed.')
  return data
}
export const listWorkspaces = () => rpc('list_my_workspaces')
export const createWorkspace = (name, config) => rpc('create_workspace', { p_name: name, p_config: config })
export const listInvitations = () => rpc('list_workspace_invitations')
export const createInvitation = (email, role) => rpc('create_workspace_invitation', { p_email: email.trim(), p_role: role })
export const revokeInvitation = (id) => rpc('revoke_workspace_invitation', { p_id: id })
export const acceptInvitation = (token) => rpc('accept_workspace_invitation', { p_token: token })
export async function updateMember(profile, { role, active }) {
  if (!activeWorkspaceId) throw new Error('Choose a workspace first.')
  const result = await rpc('update_team_member_access', { p_target_id: profile.id,
    p_expected_version: profile.access_version, p_role: role, p_active: active,
    p_area_access: active ? ['crm'] : [], p_reason: 'Workspace membership updated' })
  const member = Array.isArray(result) ? result[0] : result
  if (!member?.id) throw new Error('The membership update could not be verified. Refresh the team.')
  return member
}
export function chooseWorkspace(id, userId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('The workspace ID is invalid.')
  sessionStorage.setItem(WORKSPACE_SELECTION_KEY, JSON.stringify({ id, userId, project: connectionIdentity(connectionConfig) }))
  sessionStorage.removeItem('workspace-crm.dashboard-state.v1')
  // Full reload tears down old requests, subscriptions, editors and records.
  window.location.reload()
}
export function clearWorkspaceSelection() {
  sessionStorage.removeItem(WORKSPACE_SELECTION_KEY)
  sessionStorage.removeItem('workspace-crm.dashboard-state.v1')
  window.location.reload()
}
