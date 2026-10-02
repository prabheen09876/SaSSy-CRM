// Shared server contract for the CRM team UI. Passwords exist only in the
// submitted request and newly issued credential dialog, never in profile data.
export const TEAM_PROFILE_FIELDS = 'id,name,email,role,active,area_access,access_version,password_change_required'
export const PASSWORD_HELP = 'Use 6–128 characters with uppercase, lowercase, a number and a symbol.'
export const TEMPORARY_PASSWORD_HELP = 'Use 6–128 characters with uppercase, lowercase, a number and a symbol. Do not use spaces or control characters.'
export const PLATFORMS = [{ id: 'crm', label: 'CRM workspace' }]
const CRM_ROLES = ['admin', 'sub-admin', 'coordinator', 'reception', 'marketing']
export const compatiblePlatforms = (role) => CRM_ROLES.includes(role) ? ['crm'] : []
export const requiredPlatforms = compatiblePlatforms
export const defaultPlatforms = compatiblePlatforms

export function validStaffPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 128
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
}

export function passwordOptions(mode, password) {
  if (mode === 'generate') return { password_mode: 'generate' }
  if (mode !== 'manual' || !validStaffPassword(password) || /[\s\p{C}]/u.test(password)) throw new Error(TEMPORARY_PASSWORD_HELP)
  return { password_mode: 'manual', temporary_password: password }
}

export function accountActionPayload(profile, action, options = {}) {
  if (!profile?.id || !Number.isInteger(profile.access_version) || profile.access_version < 1) {
    throw new Error('Refresh the team before changing this account.')
  }
  if (!['reset_password', 'resend_credentials', 'deactivate'].includes(action)) throw new Error('Invalid account action.')
  return {
    id: profile.id,
    expected_version: profile.access_version,
    action,
    ...(action === 'reset_password' ? passwordOptions(options.password_mode || 'generate', options.temporary_password) : {}),
  }
}

export function teamAccountNotice(result, fallback) {
  // The explicit delivery state is authoritative. Older Workers only return
  // email_sent; false must never turn an uncertain send into a resend prompt.
  const status = result.email_status === undefined
    ? result.email_sent === false ? 'failed' : result.email_sent === true ? 'accepted' : result.expectsEmail === true ? 'unknown' : null
    : ['accepted', 'failed', 'unknown'].includes(result.email_status) ? result.email_status : 'unknown'
  const hasIssuedPassword = issuedTeamCredentials(result) !== null
  const deliveryMessage = status === 'unknown'
    ? hasIssuedPassword
      ? 'Account updated. Email delivery could not be confirmed. You can copy and use the new temporary password directly. Check the registered inbox and business Sent mail before issuing new credentials.'
      : 'Account updated. Email delivery could not be confirmed. Check the registered inbox and business Sent mail before issuing new credentials.'
    : status === 'failed'
      ? hasIssuedPassword
        ? 'Account updated, but the credentials email was not sent. Copy these login details and use the new temporary password directly.'
        : 'Account updated, but the credentials email was not sent. Check the business email connection before trying again.'
      : fallback
  return {
    // Worker messages are sanitized, actionable copy. Do not append advice that
    // contradicts them or expose provider payloads or diagnostic reason fields.
    message: typeof result.message === 'string' && result.message.trim() ? result.message : deliveryMessage,
    warning: result.warning === true || status === 'failed' || status === 'unknown',
  }
}

export function issuedTeamCredentials(result) {
  if (result?.ok !== true || result.expectsEmail !== true || !result.profile?.id || !result.profile?.email
    || !validStaffPassword(result.temporary_password)) return null
  return { name: result.profile.name || 'Team member', email: result.profile.email, password: result.temporary_password }
}

export function hasCrmAccess(profile) {
  return profile?.active === true && profile.password_change_required !== true
    && Array.isArray(profile.area_access) && profile.area_access.includes('crm')
}

// A live database gate catches administrator resets even while the JWT is old.
// Only admin-owned app_metadata is trusted; user_metadata is never an authority.
export async function checkStaffPasswordGate(client) {
  const [identity, gate] = await Promise.all([client.auth.getUser(), client.rpc('staff_password_change_required')])
  if (identity.error || !identity.data?.user?.id) throw new Error('Your session could not be verified. Sign in again.')
  if (gate.error || typeof gate.data !== 'boolean') throw new Error('Account access could not be verified. Try again.')
  const metadata = identity.data.user.app_metadata || {}
  return {
    user: identity.data.user,
    required: gate.data === true || metadata.must_change_password === true,
    // The Worker validates the trusted completion marker before recovery. A
    // password was already chosen; never offer an input it would silently ignore.
    recoveryRequired: gate.data === true && metadata.must_change_password !== true
      && typeof metadata.password_change_completed_at === 'string',
  }
}
