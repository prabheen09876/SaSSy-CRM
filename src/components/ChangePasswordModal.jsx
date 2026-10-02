import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../App.jsx'
import { X, Check } from '../lib/icons.jsx'

// Self-service password change for the signed-in user (Supabase Auth).
export default function ChangePasswordModal({ onClose }) {
  const { notify, me } = useApp()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    if (pw.length < 8) return notify('Use at least 8 characters', true)
    if (pw !== pw2) return notify('The two passwords don’t match', true)
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return notify('Could not update password: ' + error.message, true)
    notify('Password updated')
    onClose()
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target.classList.contains('overlay')) onClose() }}>
      <form className="modal" onSubmit={save} style={{ maxWidth: 420 }}>
        <div className="mhead"><h2>Change password</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="mbody">
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
            Signed in as <strong>{me?.email || me?.name || 'you'}</strong>. Set a new password for your own account.
          </p>
          <div className="stack">
            <div className="field">
              <label>New password</label>
              <div style={{ position: 'relative' }}>
                <input type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={pw}
                  onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" style={{ paddingRight: 58 }} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 6px' }}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2}
                onChange={(e) => setPw2(e.target.value)} placeholder="Re-enter it" />
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}><Check /> {busy ? 'Saving…' : 'Update password'}</button>
        </div>
      </form>
    </div>
  )
}
