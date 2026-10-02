import { useEffect, useState } from 'react'
import { supabase, connectionConfig, connectionsLocked } from '../lib/supabase'
import { accountSetupPending, ACCOUNT_SETUP_KEY } from '../lib/connections'
import { rolePill, roleLabel } from '../lib/auth'
import Brand from './Brand.jsx'
import ConnectionSettings from './ConnectionSettings.jsx'

const initials = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// Demo mode: pick a persona to explore the role hierarchy with no backend.
function PersonaPicker({ personas, onPick, onConnections }) {
  return (
    <div className="login-wrap">
      <div className="login" style={{ maxWidth: 440 }}>
        <Brand />
        <h1 className="login-title">Make room for better relationships.</h1>
        <p className="lead">Explore a CRM that fits your business. Choose a sample role to begin.</p>
        <div className="persona-grid">
          {personas.map((p) => (
            <button key={p.id} className="persona" onClick={() => onPick(p.id)}>
              <span className="pa">{initials(p.name)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="pn">{p.name}<span className={'pill ' + rolePill(p.role)} style={{ fontSize: 10.5 }}><span className="dot" />{p.title}</span></span>
                <span className="pt">{p.blurb}</span>
              </span>
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 16, lineHeight: 1.5 }}>
          Sample records reset when you reload. Your business settings stay saved on this device. Connect your own database for shared, permanent records.
        </p>
        <button className="btn block" onClick={onConnections}>Connect a real database</button>
      </div>
    </div>
  )
}

function SignInForm({ notify, message, saas, onConnections, onSaasSetup }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const [firstSetup] = useState(() => saas && accountSetupPending(connectionConfig))
  const [mode, setMode] = useState(() => firstSetup ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (firstSetup) { try { sessionStorage.removeItem(ACCOUNT_SETUP_KEY) } catch {} }
  }, [firstSetup])

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setNotice(''); setBusy(true)
    try {
      const redirectTo = window.location.origin + window.location.pathname
      const result = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: redirectTo } })
        : mode === 'reset' ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
          : await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) throw result.error
      if (mode !== 'signin') setNotice(mode === 'signup' ? 'Check your inbox to verify your email, then sign in. If you already have an account, use Sign in.' : 'If an account exists, a password reset link will arrive in your inbox.')
    } catch (error) { setErr(error.message || 'Could not complete sign in.') }
    finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <Brand />
        <p className="lead">{mode === 'signup' ? 'Create your account.' : mode === 'reset' ? 'Reset your password.' : 'Sign in to your workspace.'}</p>
        {firstSetup && mode === 'signup' && <p className="login-setup-note" role="status">Database connected. Next, choose your own email and password. After verifying your email, you can create your business workspace. Already have an account? Choose Sign in below.</p>}
        {message && <p role="status" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>{message}</p>}
        {err && <div className="err" role="alert">{err}</div>}
        {notice && <p role="status">{notice}</p>}
        {mode === 'signup' && <div className="field"><label htmlFor="signup-name">Your name</label><input id="signup-name" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
        {mode !== 'reset' && <div className="field">
          <label htmlFor="pw">Password</label>
          <div style={{ position: 'relative' }}>
            <input id="pw" type={show ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 10 : undefined} maxLength={128}
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ paddingRight: 58 }} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 6px' }}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>}
        <button className="btn primary block" disabled={busy} type="submit" style={{ marginTop: 6 }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
        </button>
        <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.5 }}>
          {saas ? 'One account can join several businesses. Access and roles are separate in each workspace.' : 'This installation uses administrator-created accounts. Connecting a database does not create a login.'}
        </p>
        {saas && <div className="login-links">{['signin', 'signup', 'reset'].filter((item) => item !== mode).map((item) => <button key={item} className="btn ghost sm" type="button" disabled={busy} onClick={() => { setMode(item); setErr(''); setNotice(''); setPassword('') }}>{item === 'signin' ? 'Sign in' : item === 'signup' ? 'Create an account' : 'Forgot password?'}</button>)}</div>}
        {!saas && <div className="login-first-setup"><strong>Setting up for the first time?</strong><p>{connectionsLocked
          ? 'The platform owner manages this connection. Ask them to create your account or configure SaaS mode for self-service signup.'
          : 'For a SaaS CRM where each business creates its own account and workspace, continue with SaaS setup.'}</p>
          {!connectionsLocked && <button type="button" className="btn block" onClick={onSaasSetup} disabled={busy}>Set up SaaS accounts</button>}</div>}
        <button type="button" className="btn ghost block" onClick={onConnections}>Connection settings</button>
      </form>
    </div>
  )
}

export default function Login({ notify, demo, personas, onPick, message, saas, onConnections }) {
  const [setup, setSetup] = useState(null)
  const openConnections = onConnections || (() => setSetup('current'))
  if (setup) return <div className="setup-page"><Brand /><ConnectionSettings initialMode={setup === 'saas' ? 'saas' : undefined} /><button className="btn ghost" onClick={() => setSetup(null)}>Back to sign in</button></div>
  if (demo) return <PersonaPicker personas={personas} onPick={onPick} onConnections={openConnections} />
  return <SignInForm notify={notify} message={message} saas={saas} onConnections={openConnections} onSaasSetup={() => setSetup('saas')} />
}
