import { useState } from 'react'
import { completeTemporaryPassword } from '../lib/db'
import { PASSWORD_HELP, validStaffPassword } from '../lib/teamAccounts'
import Brand from './Brand.jsx'

export default function TemporaryPassword({ email, recoveryRequired = false, onComplete, onSignOut }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setError('')
    if (!recoveryRequired && !validStaffPassword(password)) return setError(PASSWORD_HELP)
    if (!recoveryRequired && password !== confirmation) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      await completeTemporaryPassword(recoveryRequired ? '' : password)
      setPassword(''); setConfirmation('')
      onComplete()
    } catch (err) {
      if (err.payload?.password_saved === true) {
        setPassword(''); setConfirmation('')
        onComplete({ recoveryPending: true })
      } else setError(err.message)
    }
    finally { setBusy(false) }
  }
  return <div className="login-wrap"><form className="login" onSubmit={submit}>
    <Brand />
    <h1 style={{ fontSize: 22, margin: '20px 0 12px' }}>{recoveryRequired ? 'Finish account setup' : 'Choose your private password'}</h1>
    <p className="lead">{recoveryRequired ? `Your private password for ${email} is saved. Finish the pending account setup to restore access.` : `You signed in with temporary credentials for ${email}. Change your password before opening the CRM.`}</p>
    {error && <div className="err" role="alert">{error}</div>}
    {!recoveryRequired && <><div className="field"><label htmlFor="private-password">New password</label><input id="private-password" type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
      <small className="faint">{PASSWORD_HELP} Choose a password different from the temporary one.</small></div>
    <div className="field"><label htmlFor="private-confirmation">Confirm new password</label><input id="private-confirmation" type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></div></>}
    <button type="submit" className="btn primary block" disabled={busy}>{busy ? 'Saving…' : recoveryRequired ? 'Finish setup' : 'Save password and sign in again'}</button>
    <button type="button" className="btn ghost block" onClick={onSignOut} disabled={busy} style={{ marginTop: 8 }}>Sign out</button>
  </form></div>
}
