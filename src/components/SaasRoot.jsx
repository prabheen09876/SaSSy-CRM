import { useEffect, useRef, useState } from 'react'
import App from '../App.jsx'
import Login from './Login.jsx'
import Brand from './Brand.jsx'
import ConnectionSettings from './ConnectionSettings.jsx'
import { supabase, activeWorkspaceId, configurationError, connectionConfig } from '../lib/supabase'
import { selectedWorkspace, INVITATION_KEY, connectionIdentity, pendingInvitation, validInvitationToken } from '../lib/connections'
import { listWorkspaces, createWorkspace, chooseWorkspace, acceptInvitation } from '../lib/saas'
import { INDUSTRY_PRESETS, normalizeWorkspace } from '../lib/workspace'
import { roleLabel } from '../lib/auth'

const INVITE_KEY = INVITATION_KEY
function readInvitation() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('invite')
  const project = connectionIdentity(connectionConfig)
  if (validInvitationToken(token)) {
    sessionStorage.setItem(INVITE_KEY, JSON.stringify({ project, token }))
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return token
  }
  return pendingInvitation(project)
}

export default function SaasRoot() {
  const [session, setSession] = useState(undefined)
  const [workspaces, setWorkspaces] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('general')
  const [invite, setInvite] = useState(readInvitation)
  const [connections, setConnections] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const sessionRef = useRef(null)

  useEffect(() => {
    const onInvitationLink = () => setInvite(readInvitation())
    window.addEventListener('hashchange', onInvitationLink)
    return () => window.removeEventListener('hashchange', onInvitationLink)
  }, [])

  useEffect(() => {
    let alive = true, eventSeen = false
    const accept = (next) => {
      if (!alive) return
      if (sessionRef.current?.user.id !== next?.user.id) { setWorkspaces(null); setError(''); setBusy(false) }
      sessionRef.current = next; setSession(next)
    }
    supabase.auth.getSession().then(({ data }) => { if (!eventSeen) accept(data.session) }).catch(() => accept(null))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      eventSeen = true
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      accept(next)
    })
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    setError('')
    listWorkspaces().then((rows) => { if (alive) setWorkspaces(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) { setWorkspaces(null); setError('Workspaces could not be loaded. Check your connection and SaaS database setup, then retry.') } })
    return () => { alive = false }
  }, [session?.access_token, retry])

  const perform = async (action) => {
    if (busy) return
    const identity = sessionRef.current?.user.id
    setBusy(true); setError('')
    try { await action(identity) } catch (e) { if (sessionRef.current?.user.id === identity) setError(e.message || 'Could not complete the request.') }
    finally { if (sessionRef.current?.user.id === identity) setBusy(false) }
  }
  const signOut = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Could not sign out. Check your connection and try again.')
    setRecovery(false); setPassword('')
  }
  const enter = async (id, identity) => {
    if (sessionRef.current?.user.id === identity) chooseWorkspace(id, identity)
  }

  if (configurationError || connections) return <div className="setup-page"><Brand /><ConnectionSettings /><button className="btn ghost" onClick={() => setConnections(false)}>Back to sign in</button></div>
  if (session === undefined) return <div className="center" role="status">Loading your account…</div>
  if (!session) return <Login saas onConnections={() => setConnections(true)} message={invite ? 'Sign in or create an account with the invited email address to join the workspace.' : ''} />
  if (recovery) return <div className="login-wrap"><form className="login" onSubmit={(e) => {
    e.preventDefault(); void perform(async () => { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; await signOut() })
  }}><Brand /><h1 className="login-title">Choose a new password</h1><div className="field"><label htmlFor="recovery-password">New password</label>
    <input id="recovery-password" type="password" minLength={10} maxLength={128} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
    {error && <p className="err" role="alert">{error}</p>}<button className="btn primary block" disabled={busy}>Save password &amp; sign out</button></form></div>
  const selected = selectedWorkspace()
  if (!invite && workspaces?.some((item) => item.id === activeWorkspaceId) && selected?.userId === session.user.id) return <App />

  return <div className="workspace-entry">
    <header><Brand /><button className="btn ghost" onClick={() => perform(signOut)} disabled={busy}>Sign out</button></header>
    <div className="workspace-entry-intro"><h1>Your work, in its own space.</h1><p>Each business has its own records, settings and team. You’re signed in as {session.user.email}.</p></div>
    {error && <div className="err" role="alert">{error}<button className="btn sm" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    {invite && <section className="panel"><h2>Join an invited workspace</h2><p>Only the verified email address on the invitation can accept it. Your other workspaces will not change.</p>
      <button className="btn primary" disabled={busy} onClick={() => perform(async (identity) => {
        const id = await acceptInvitation(invite)
        if (sessionRef.current?.user.id !== identity) return
        sessionStorage.removeItem(INVITE_KEY); setInvite(''); await enter(id, identity)
      })}>{busy ? 'Joining…' : 'Accept invitation'}</button>
      <button className="btn ghost" disabled={busy} onClick={() => { sessionStorage.removeItem(INVITE_KEY); setInvite('') }}>Dismiss invitation</button></section>}
    {workspaces === null && !error ? <p role="status">Loading workspaces…</p> : <>
      {!!workspaces?.length && <section className="workspace-list" aria-label="Your workspaces">{workspaces.map((item) => <button className="workspace-choice" key={item.id} onClick={() => chooseWorkspace(item.id, session.user.id)} disabled={busy}>
        <strong>{item.name}</strong><span>{roleLabel(item.role)}</span><span>Open workspace</span></button>)}</section>}
      <form className="panel workspace-create" onSubmit={(e) => {
        e.preventDefault(); void perform(async (identity) => {
          const preset = INDUSTRY_PRESETS.find((p) => p.id === industry)
          const config = normalizeWorkspace({ name, industry, terminology: preset.terminology, stageLabels: preset.stageLabels, customFields: preset.customFields, setupComplete: true })
          const id = await createWorkspace(name.trim(), config); await enter(id, identity)
        })
      }}><h2>{workspaces?.length ? 'Create another workspace' : 'Create your first workspace'}</h2>
        <p>Start with your business name and an industry preset. You can change the language and fields in Settings.</p>
        <div className="field"><label htmlFor="new-workspace-name">Business name</label><input id="new-workspace-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" disabled={busy} /></div>
        <div className="field"><label htmlFor="new-workspace-industry">Industry</label><select id="new-workspace-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy}>{INDUSTRY_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></div>
        <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create workspace'}</button>
        <p className="faint">Your email must be verified before you can create or join a workspace.</p>
      </form>
    </>}
  </div>
}
