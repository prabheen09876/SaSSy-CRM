import { useState, useId } from 'react'
import './connections.css'
import { supabase, hasConfig, connectionConfig, connectionsLocked } from '../lib/supabase'
import { checkConnection, normalizeConnection, CONNECTION_KEY, WORKSPACE_SELECTION_KEY, INVITATION_KEY, ACCOUNT_SETUP_KEY, connectionIdentity } from '../lib/connections'

export default function ConnectionSettings({ editable = true, initialMode }) {
  const [draft, setDraft] = useState(() => ({ ...connectionConfig, ...(!connectionsLocked && editable && ['saas', 'supabase'].includes(initialMode) ? { mode: initialMode } : {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tested, setTested] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const id = useId()
  const locked = !editable || connectionsLocked
  const change = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setTested(null); setError(''); setConfirmed(false) }
  const test = async () => {
    setBusy(true); setError(''); setTested(null)
    try { const result = await checkConnection(draft); setTested({ signature: JSON.stringify(draft), ...result }) }
    catch (e) { setError(e.name === 'TimeoutError' ? 'The connection timed out. Check the URL and try again.' : e.message || 'Connection could not be checked.') }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (locked || busy || !confirmed || tested?.signature !== JSON.stringify(draft)) return
    setBusy(true); setError('')
    try {
      const clean = normalizeConnection(draft)
      // Sign out of the old project before switching; never carry its token to
      // the new endpoint. Saving does not migrate, erase, or copy any records.
      if (hasConfig) { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error }
      localStorage.setItem(CONNECTION_KEY, JSON.stringify(clean))
      sessionStorage.removeItem(WORKSPACE_SELECTION_KEY)
      sessionStorage.removeItem(INVITATION_KEY)
      sessionStorage.removeItem('workspace-crm.dashboard-state.v1')
      if (clean.mode === 'saas' && (connectionConfig.mode !== 'saas' || connectionIdentity(clean) !== connectionIdentity(connectionConfig))) {
        sessionStorage.setItem(ACCOUNT_SETUP_KEY, JSON.stringify({ project: connectionIdentity(clean) }))
      } else sessionStorage.removeItem(ACCOUNT_SETUP_KEY)
      window.location.reload()
    } catch (e) { setError(e.message || 'Could not save this connection.'); setBusy(false) }
  }
  const field = (key, label, placeholder, type = 'text') => <div className="field">
    <label htmlFor={`${id}-${key}`}>{label}</label>
    <input id={`${id}-${key}`} type={type} value={draft[key]} onChange={(e) => change(key, e.target.value)}
      disabled={locked || busy} placeholder={placeholder} autoComplete="off" spellCheck="false" />
  </div>
  return <section className="connection-settings">
    <h2>Database &amp; Cloudflare</h2>
    <p className="sub">Connect this installation to your own infrastructure. Customers of a hosted CRM only need an account, not their own database.</p>
    <div className="connection-summary" role="note">
      <strong>{hasConfig ? 'Live connection selected' : 'Demo mode'}</strong>
      <span>{connectionsLocked ? 'Managed by this deployment. Customers cannot replace shared infrastructure.' : 'Changes apply to this browser only. To launch publicly, publish these public values as deployment configuration.'}</span>
    </div>
    <div className="field"><label htmlFor={`${id}-mode`}>Installation type</label>
      <select id={`${id}-mode`} value={draft.mode} disabled={locked || busy} onChange={(e) => change('mode', e.target.value)}>
        <option value="demo">Demo — sample records</option><option value="saas">SaaS — separate workspaces for many businesses</option>
        <option value="supabase">Standalone — one business database</option>
      </select>
    </div>
    {draft.mode !== 'demo' && <p className="connection-next-step">{draft.mode === 'saas'
      ? 'After connecting, create your own account, verify your email, and create your business workspace. No login is created by saving this connection.'
      : 'Standalone mode has no self-service signup. The installation owner must create the first account in Supabase Authentication and activate its CRM profile before anyone can sign in.'}</p>}
    {draft.mode !== 'demo' && <>
      {field('supabaseUrl', 'Supabase project URL', 'https://your-project.supabase.co', 'url')}
      {field('publicKey', 'Supabase publishable key', 'sb_publishable_…', 'password')}
      <p className="faint">Find these under Supabase → Project settings → API. Never enter a service-role key or database password.</p>
      {field('workerUrl', 'Cloudflare Worker URL (optional)', 'https://your-crm.workers.dev', 'url')}
      <p className="faint">Connect the included CRM gateway. A reachable gateway does not mean email, WhatsApp or AI providers are installed.</p>
    </>}
    {error && <p className="err" role="alert">{error}</p>}
    {tested && <p className="connection-result" role="status">{tested.database === 'demo' ? 'Demo mode is ready. No server is used.' : `Database reachable; ${draft.mode === 'saas' ? 'SaaS' : 'standalone'} schema verified. Cloudflare: ${tested.gateway}. No records were changed.`}</p>}
    <div className="save-row"><button className="btn" onClick={test} disabled={busy}>{busy ? 'Checking…' : 'Test connection'}</button></div>
    {!locked && <>
      <label className="connection-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
        I understand this signs me out and reloads this browser. Existing records are not moved or deleted.</label>
      <button className="btn primary" onClick={save} disabled={busy || !confirmed || tested?.signature !== JSON.stringify(draft)}>Save connection &amp; reload</button>
    </>}
    <details className="connection-help"><summary>First-time setup checklist</summary>
      <ol><li>Create a new, empty Supabase project. Run <code>supabase/saas.sql</code> for SaaS, or <code>supabase/standalone.sql</code> for one business. Never run both on the same database.</li>
        <li>For SaaS, enable email signup and email confirmation in Supabase Authentication, and add this app’s URL to the redirect allowlist.</li>
        <li>Copy the project URL and publishable key above, then test and save. In SaaS, create an account and your first workspace. In standalone mode, the operator must first create and activate an owner using the README instructions.</li>
        <li>Optional: deploy the included <code>cloudflare/</code> gateway with this app’s origin allowed. Then add its URL above.</li>
        <li>For public hosting, set <code>VITE_CRM_MODE=saas</code>, the public Supabase values, and optional Worker URL in your host. Rebuild once; all customers then use the same hosted sign-in.</li></ol>
      <p>Infrastructure must be created once by the platform owner. This screen does not provision paid cloud accounts, run database migrations, or store private cloud credentials.</p>
    </details>
  </section>
}
