import { useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import IntegrationNotice from './IntegrationNotice.jsx'
import { insertProfile, updateTeamAccess, manageTeamAccount, initials } from '../lib/db'
import { roleLabel, rolePill, assignableRoles, canManagePerson, ALL_ROLES } from '../lib/auth'
import { PLATFORMS, TEMPORARY_PASSWORD_HELP, compatiblePlatforms, requiredPlatforms, defaultPlatforms, passwordOptions, teamAccountNotice, issuedTeamCredentials } from '../lib/teamAccounts'
import { UserPlus, Check, X } from '../lib/icons.jsx'
import IssuedCredentials from './IssuedCredentials.jsx'

const ROLE_RANK = Object.fromEntries(ALL_ROLES.map((role, index) => [role, index]))

function PasswordFields({ mode, setMode, password, setPassword, busy }) {
  return <>
    <div className="field"><label htmlFor="team-password-mode">Temporary password</label>
      <select id="team-password-mode" value={mode} onChange={(event) => { setMode(event.target.value); setPassword('') }} disabled={busy}>
        <option value="generate">Generate automatically</option><option value="manual">Set manually</option>
      </select>
    </div>
    {mode === 'manual' && <div className="field"><label htmlFor="team-temporary-password">Set temporary password</label>
      <input id="team-temporary-password" type="password" autoComplete="new-password" value={password}
        onChange={(event) => setPassword(event.target.value)} minLength={6} maxLength={128} required disabled={busy} aria-describedby="team-password-help" />
      <small id="team-password-help" className="faint">{TEMPORARY_PASSWORD_HELP}</small>
    </div>}
    <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>You can view and copy the new credentials after saving. We also attempt email delivery. The member must choose a private password after signing in.</p>
  </>
}

function PlatformFields({ role, selected, setSelected, busy }) {
  const required = requiredPlatforms(role)
  return <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}><legend>Platform access</legend>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {PLATFORMS.filter(({ id }) => compatiblePlatforms(role).includes(id)).map(({ id, label }) => <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={selected.includes(id)} disabled={busy || required.includes(id)}
          onChange={(event) => setSelected(event.target.checked ? [...selected, id] : selected.filter((area) => area !== id))} />
        {label}{required.includes(id) ? ' (required)' : ''}
      </label>)}
    </div>
  </fieldset>
}

function AccountModal({ mode, target, me, onSaved, onClose }) {
  const edit = mode === 'edit', reset = mode === 'reset', reactivate = mode === 'reactivate'
  const roles = assignableRoles(me)
  const [name, setName] = useState(target?.name || '')
  const [email, setEmail] = useState(target?.email || '')
  const [role, setRole] = useState(target?.role || 'coordinator')
  const [areas, setAreas] = useState(target?.active ? target.area_access : defaultPlatforms(target?.role || 'coordinator'))
  const [reason, setReason] = useState('')
  const [passwordMode, setPasswordMode] = useState('generate')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (event) => {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      let result
      if (edit) result = { profile: await updateTeamAccess(target, { role, area_access: areas, reason: reason.trim() }), message: 'Team access updated.' }
      else if (reset) result = await manageTeamAccount(target, 'reset_password', passwordOptions(passwordMode, password))
      else result = await insertProfile({ name: name.trim(), email: email.trim().toLowerCase(), role, area_access: areas, ...passwordOptions(passwordMode, password) })
      setPassword('')
      onSaved({ ...result, expectsEmail: !edit }, edit ? 'Team access updated.' : 'Credentials emailed. The member must change the temporary password after signing in.')
      onClose()
    } catch (err) {
      if (err.payload?.profile) { onSaved({ profile: err.payload.profile, message: err.message, warning: true }); onClose() }
      else setError(err.message)
    } finally { setBusy(false) }
  }
  return <div className="overlay"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title" onSubmit={save}>
    <div className="mhead"><h2 id="team-modal-title">{edit ? 'Edit team access' : reset ? 'Reset password' : reactivate ? 'Reactivate team member' : 'Add Team Member'}</h2>
      <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></div>
    <div className="mbody"><div className="stack">
      {error && <div className="err" role="alert">{error}</div>}
      {target && <p style={{ fontSize: 13, lineHeight: 1.5 }}><strong>{target.name}</strong><br />Username: {target.email}</p>}
      {!edit && !reset && <>
        <div className="field"><label htmlFor="team-name">Name</label><input id="team-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus minLength={2} maxLength={120} required disabled={busy} /></div>
        <div className="field"><label htmlFor="team-email">Email / username</label><input id="team-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" maxLength={254} required disabled={busy || reactivate} /></div>
      </>}
      {!reset && <>
        <div className="field"><label htmlFor="team-role">Role</label><select id="team-role" value={role} disabled={busy} onChange={(event) => { setRole(event.target.value); setAreas(defaultPlatforms(event.target.value)) }}>
          {roles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></div>
        <PlatformFields role={role} selected={areas || []} setSelected={setAreas} busy={busy} />
      </>}
      {edit ? <div className="field"><label htmlFor="team-reason">Reason for access change</label><textarea id="team-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required disabled={busy} /></div>
        : <PasswordFields mode={passwordMode} setMode={setPasswordMode} password={password} setPassword={setPassword} busy={busy} />}
      {reset && <p className="faint" style={{ fontSize: 12.5 }}>The old password will stop working. The new temporary password works even if email delivery is unavailable.</p>}
    </div></div>
    <div className="mfoot"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" className="btn primary" disabled={busy}><Check /> {busy ? 'Saving…' : edit ? 'Save access' : reset ? 'Reset password' : 'Save member'}</button></div>
  </form></div>
}

function ConfirmAccountAction({ target, action, onSaved, onClose }) {
  const deactivate = action === 'deactivate'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await manageTeamAccount(target, action)
      onSaved({ ...result, expectsEmail: !deactivate, email_sent: deactivate ? undefined : result.email_sent, warning: result.auth_disabled === false },
        deactivate ? 'Team member deactivated. History is preserved.' : 'Fresh credentials emailed. The old password no longer works.')
      onClose()
    } catch (err) {
      if (err.payload?.profile) { onSaved({ profile: err.payload.profile, message: err.message, warning: true }); onClose() }
      else setError(err.message)
    } finally { setBusy(false) }
  }
  return <div className="overlay"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="team-confirm-title" onSubmit={submit}>
    <div className="mhead"><h2 id="team-confirm-title">{deactivate ? 'Deactivate team member' : 'Resend credentials'}</h2></div>
    <div className="mbody"><div className="stack">
      {error && <div className="err" role="alert">{error}</div>}
      <p><strong>{target.name}</strong><br />{target.email}</p>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>{deactivate
        ? 'This member will lose access to all platforms and cannot sign in. Their historical records will be preserved.'
        : 'This generates a new temporary password that you can view and copy, and attempts email delivery to the registered address above. The old password stops working. The member must change the temporary password after signing in.'}</p>
    </div></div>
    <div className="mfoot"><button type="button" className="btn" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
      <button type="submit" className={'btn ' + (deactivate ? 'danger' : 'primary')} disabled={busy}>{busy ? 'Saving…' : deactivate ? 'Deactivate member' : 'Generate and resend'}</button></div>
  </form></div>
}

export default function Team() {
  const { profiles, me, can, applyProfile, refreshProfiles } = useApp()
  const [modal, setModal] = useState(null)
  const [notice, setNotice] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const sorted = useMemo(() => [...profiles].sort((a, b) => (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99) || (a.name || '').localeCompare(b.name || '')), [profiles])
  const saved = (result, fallback) => {
    if (result.profile) applyProfile(result.profile)
    setNotice(teamAccountNotice(result, fallback))
    setCredentials(issuedTeamCredentials(result))
  }
  const open = (value) => { setCredentials(null); setNotice(null); setModal(value) }
  return <>
    <IntegrationNotice feature="Account invitations" />
    <div className="page-head"><div><span className="ttl">Team</span><p className="sub">Manage your team’s accounts and CRM access. Each member signs in with their registered email.</p></div>
      <div className="actions"><button className="btn" disabled={refreshing} onClick={async () => { setRefreshing(true); await refreshProfiles(); setRefreshing(false) }}>{refreshing ? 'Refreshing…' : 'Refresh team'}</button>
        {can('team.manage') && <button className="btn primary" onClick={() => open({ mode: 'add' })}><UserPlus /> Add Team Member</button>}</div></div>
    {notice && <div className={notice.warning ? 'err' : 'panel'} role="status">{notice.message}</div>}
    <div className="panel"><div className="stack">
      {sorted.map((person, index) => <div key={person.id} className="row-between" style={{ gap: 16, flexWrap: 'wrap', ...(index ? { borderTop: '1px solid var(--line)', paddingTop: 14 } : {}) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}><span className="avatar sm">{initials(person.name)}</span><div>
          <strong>{person.name || 'Unnamed'}</strong> {person.id === me.id && <span className="badge">You</span>}
          <div style={{ fontSize: 12.5, marginTop: 3 }}>Username: {person.email || 'No registered email'}</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{person.active ? (person.area_access || []).map((area) => PLATFORMS.find(({ id }) => id === area)?.label || area).join(' · ') : 'Inactive'}{person.active && person.password_change_required ? ' · Temporary password — change required' : ''}</div>
        </div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className={'pill ' + rolePill(person.role)}>{roleLabel(person.role)}</span>
          {canManagePerson(me, person) && (person.active ? <>
            <button className="btn ghost sm" onClick={() => open({ mode: 'edit', target: person })}>Edit access</button>
            <button className="btn sm" onClick={() => open({ mode: 'reset', target: person })}>Reset Password</button>
            <button className="btn sm" onClick={() => open({ action: 'resend_credentials', target: person })}>Resend Credentials</button>
            <button className="btn danger sm" onClick={() => open({ action: 'deactivate', target: person })}>Deactivate</button>
          </> : <><button className="btn sm" onClick={() => open({ mode: 'reactivate', target: person })}>Reactivate</button>
            <button className="btn ghost sm" onClick={() => open({ action: 'deactivate', target: person })}>Ensure sign-in disabled</button></>)}
        </div>
      </div>)}
      {!sorted.length && <div className="empty">No team members yet.</div>}
    </div></div>
    {modal && (modal.action ? <ConfirmAccountAction {...modal} onSaved={saved} onClose={() => setModal(null)} />
      : <AccountModal {...modal} me={me} onSaved={saved} onClose={() => setModal(null)} />)}
    {credentials && <IssuedCredentials credentials={credentials} deliveryNotice={notice} onClose={() => setCredentials(null)} />}
  </>
}
