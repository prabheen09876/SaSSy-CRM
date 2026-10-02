import { useState } from 'react'
import { X } from '../lib/icons.jsx'

// This component is mounted only for the newly issued server response. Closing
// it clears its parent state; credentials never enter a profile or persistent store.
export default function IssuedCredentials({ credentials, deliveryNotice, onClose }) {
  const [visible, setVisible] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credentials.password)
      setCopyMessage('Password copied.')
    } catch {
      setCopyMessage('Could not copy. Use Show password and copy it manually.')
    }
  }
  const close = () => { setVisible(false); setCopyMessage(''); onClose() }
  return <div className="overlay">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="issued-credentials-title" onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      <div className="mhead"><h2 id="issued-credentials-title">Temporary login credentials</h2>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close credentials"><X /></button></div>
      <div className="mbody"><div className="stack">
        <p style={{ fontSize: 13, lineHeight: 1.6 }}><strong>{credentials.name}</strong><br />Username: {credentials.email}</p>
        {deliveryNotice && <p className={deliveryNotice.warning ? 'err' : 'faint'} style={{ fontSize: 13, lineHeight: 1.5 }}>{deliveryNotice.message}</p>}
        <div className="field"><label htmlFor="issued-temporary-password">New temporary password</label>
          <input id="issued-temporary-password" type={visible ? 'text' : 'password'} value={credentials.password} readOnly autoComplete="off" spellCheck={false} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setVisible((value) => !value)} aria-pressed={visible}>{visible ? 'Hide password' : 'Show password'}</button>
          <button type="button" className="btn primary" onClick={copy} autoFocus>Copy password</button>
        </div>
        {copyMessage && <p role="status" style={{ fontSize: 12.5 }}>{copyMessage}</p>}
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>The member can sign in with this email and temporary password, then choose a private password. Closing this dialog clears the displayed credentials; a later reset creates a new password.</p>
      </div></div>
      <div className="mfoot"><button type="button" className="btn" onClick={close}>Done</button></div>
    </div>
  </div>
}
