import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { assignableRoles, canManagePerson, roleLabel, rolePill, ALL_ROLES } from '../lib/auth'
import { initials } from '../lib/db'
import { createInvitation, listInvitations, revokeInvitation, updateMember } from '../lib/saas'
import { Check, Shield, UserPlus, Users, X } from '../lib/icons.jsx'
import './settings.css'

const invitationStatus = (invite) => invite.accepted_at ? { label: 'Accepted', tone: 'success' }
  : invite.revoked_at ? { label: 'Revoked', tone: 'neutral' }
    : Date.parse(invite.expires_at) <= Date.now() ? { label: 'Expired', tone: 'neutral' }
      : { label: 'Pending', tone: 'warning' }
const dateLabel = (value) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown date'
}
const roleRank = Object.fromEntries(ALL_ROLES.map((role, index) => [role, index]))

export default function SaasTeam() {
  const { me, profiles, refreshProfiles, notify, workspace } = useApp()
  const formId = useId()
  const owner = me?.role === 'admin'
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('coordinator')
  const [invitations, setInvitations] = useState([])
  const [invitationsLoading, setInvitationsLoading] = useState(owner)
  const [invitationsError, setInvitationsError] = useState('')
  const [error, setError] = useState('')
  const [issued, setIssued] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState(null)
  const [memberUpdates, setMemberUpdates] = useState({})
  const operation = useRef(false)
  const inviteLinkInput = useRef(null)
  const members = useMemo(() => (profiles || []).map((person) => {
    const saved = memberUpdates[person.id]
    // Keep a successful save visible while refresh is pending, but never mask a newer server version.
    return saved && Number(saved.access_version) > Number(person.access_version) ? saved : person
  })
    .sort((a, b) => Number(b.active) - Number(a.active) || (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) || (a.name || '').localeCompare(b.name || '')), [profiles, memberUpdates])
  const roles = assignableRoles(me)
  const invitationRoles = ALL_ROLES.filter((role) => role !== 'admin')
  const inviteLink = issued ? `${window.location.origin}${window.location.pathname}#invite=${encodeURIComponent(issued.token)}` : ''

  useEffect(() => {
    let current = true
    if (!owner) { setInvitations([]); setInvitationsLoading(false); setIssued(null); return undefined }
    setInvitationsLoading(true)
    listInvitations().then((rows) => { if (current) { setInvitations(Array.isArray(rows) ? rows : []); setInvitationsError('') } })
      .catch((err) => { if (current) setInvitationsError(err.message || 'Could not load workspace invitations.') })
      .finally(() => { if (current) setInvitationsLoading(false) })
    return () => { current = false }
  }, [owner])

  const refreshInvitations = async () => {
    if (!owner) return
    setInvitationsLoading(true)
    try { const rows = await listInvitations(); setInvitations(Array.isArray(rows) ? rows : []); setInvitationsError('') }
    catch (err) { setInvitationsError(err.message || 'Could not refresh invitations.') }
    finally { setInvitationsLoading(false) }
  }
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await refreshProfiles(); setMemberUpdates({}); await refreshInvitations() }
    catch (err) { notify(err.message || 'Could not refresh the team.', true) }
    finally { setRefreshing(false) }
  }
  const invite = async (event) => {
    event.preventDefault()
    if (!owner || operation.current) return
    operation.current = true; setBusy('invite'); setError('')
    try {
      const result = await createInvitation(email.trim(), inviteRole)
      if (!result?.id || !result?.token || !result?.email) throw new Error('The invitation link was not returned. Refresh invitations before trying again.')
      setIssued(result); setCopied(false); setEmail('')
      notify('Invitation created. Copy and share the link with your teammate.')
      await refreshInvitations()
    } catch (err) { setError(err.message || 'Could not create the invitation.') }
    finally { operation.current = false; setBusy('') }
  }
  const revoke = async (invitation) => {
    if (!owner || operation.current) return
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? Their current link will stop working.`)) return
    operation.current = true; setBusy(invitation.id); setError('')
    try {
      await revokeInvitation(invitation.id)
      setInvitations((rows) => rows.map((row) => row.id === invitation.id ? { ...row, revoked_at: new Date().toISOString() } : row))
      if (issued?.id === invitation.id) setIssued(null)
      notify('Invitation revoked.')
    } catch (err) { setError(err.message || 'Could not revoke the invitation.') }
    finally { operation.current = false; setBusy('') }
  }
  const saveMember = async (event) => {
    event.preventDefault()
    if (!editing || operation.current || !canManagePerson(me, editing.profile)) return
    operation.current = true; setBusy(editing.profile.id); setError('')
    try {
      const saved = await updateMember(editing.profile, { role: editing.role, active: editing.active })
      setMemberUpdates((current) => ({ ...current, [saved.id]: saved }))
      setEditing(null)
      notify('Workspace access updated.')
      try { await refreshProfiles() } catch { notify('Access was saved. Refresh the team to update the member list.', true) }
    } catch (err) { setError(err.message || 'Could not update workspace access.') }
    finally { operation.current = false; setBusy('') }
  }
  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
    } catch {
      inviteLinkInput.current?.focus(); inviteLinkInput.current?.select()
      notify('Select and copy the invitation link from the box.', true)
    }
  }

  return <div className="saas-team">
    <div className="settings-section-heading saas-team-heading">
      <div><h2>Team &amp; access</h2><p>Give people the right role in {workspace?.name || 'this workspace'}.</p></div>
      <button className="btn ghost sm" onClick={refresh} disabled={refreshing || !!busy}>{refreshing ? 'Refreshing…' : 'Refresh team'}</button>
    </div>
    {error && <div className="err" role="alert">{error}</div>}
    {owner && <section className="panel saas-invite-panel" aria-labelledby={`${formId}-invite-title`}>
      <div className="saas-section-title"><UserPlus /><div><h3 id={`${formId}-invite-title`}>Invite a teammate</h3><p>Create a private invitation link, then share it with the person you invite.</p></div></div>
      <form className="saas-invite-form" onSubmit={invite}>
        <div className="field"><label htmlFor={`${formId}-email`}>Email address</label><input id={`${formId}-email`} value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="off" maxLength={254} placeholder="teammate@company.com" required disabled={!!busy} /></div>
        <div className="field"><label htmlFor={`${formId}-role`}>Workspace role</label><select id={`${formId}-role`} value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} disabled={!!busy}>
          {invitationRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select></div>
        <button className="btn primary" type="submit" disabled={!!busy}><UserPlus />{busy === 'invite' ? 'Creating…' : 'Create invitation'}</button>
      </form>
      <p className="saas-form-help">An invitation creates workspace access. Your teammate signs in with their own account and verifies the invited email address.</p>
    </section>}

    {owner && issued && <section className="saas-issued-invite" aria-labelledby={`${formId}-link-title`}>
      <div className="row-between"><h3 id={`${formId}-link-title`}>Share this invitation with {issued.email}</h3><button className="icon-btn" aria-label="Dismiss invitation link" onClick={() => setIssued(null)}><X /></button></div>
      <p>No email has been sent. Only someone signed in with the verified address <strong>{issued.email}</strong> can accept this invitation.</p>
      <label htmlFor={`${formId}-link`}>Invitation link</label>
      <div className="saas-invitation-link"><input ref={inviteLinkInput} id={`${formId}-link`} type="text" readOnly value={inviteLink} onFocus={(event) => event.target.select()} spellCheck={false} />
        <button className="btn" type="button" onClick={copyLink}>{copied ? <><Check /> Copied</> : 'Copy link'}</button></div>
      <p className="saas-form-help">Expires {dateLabel(issued.expires_at)}. Copy it now; the link cannot be retrieved after a page reload or dismissal.</p>
    </section>}

    <section className="panel saas-members-panel" aria-labelledby={`${formId}-members-title`}>
      <div className="saas-roster-heading"><h3 id={`${formId}-members-title`}>Workspace members</h3><span className="faint">{members.filter((person) => person.active).length} active</span></div>
      {!members.length && <div className="empty"><Users /><p>No members to show. Refresh the team to try again.</p></div>}
      <div className="saas-member-list">{members.map((person) => <article key={person.id} className="saas-member">
        <div className="saas-member-row">
          <span className="avatar sm">{initials(person.name || person.email)}</span>
          <div className="saas-member-identity"><strong>{person.name || person.email || 'Workspace member'}{person.id === me?.id && <span className="badge">You</span>}</strong><span>{person.email || 'No email available'}</span></div>
          <div className="saas-member-access"><span className={'pill ' + rolePill(person.role)}>{roleLabel(person.role)}</span>{!person.active && <span className="pill neutral">Inactive</span>}</div>
          {canManagePerson(me, person) && <button className="btn ghost sm" disabled={!!busy} onClick={() => { setEditing({ profile: person, role: person.role, active: person.active === true }); setError('') }}>Edit access</button>}
        </div>
        {editing?.profile.id === person.id && <form className="saas-member-editor" onSubmit={saveMember}>
          <div className="field"><label htmlFor={`${formId}-edit-role`}>Workspace role</label><select id={`${formId}-edit-role`} value={editing.role} disabled={!!busy} onChange={(event) => setEditing((current) => ({ ...current, role: event.target.value }))}>
            {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select></div>
          <label className="saas-access-toggle"><input type="checkbox" checked={editing.active} disabled={!!busy} onChange={(event) => setEditing((current) => ({ ...current, active: event.target.checked }))} /><span>Active workspace access</span></label>
          <p>Disabling access removes this person's access to this workspace. Their account and activity history are kept.</p>
          <div className="saas-editor-actions"><button className="btn ghost sm" type="button" onClick={() => setEditing(null)} disabled={!!busy}>Cancel</button><button className="btn primary sm" type="submit" disabled={!!busy}><Check />{busy === person.id ? 'Saving…' : 'Save access'}</button></div>
        </form>}
      </article>)}</div>
    </section>

    {owner && <section className="panel saas-pending-invitations" aria-labelledby={`${formId}-pending-title`}>
      <div className="saas-roster-heading"><h3 id={`${formId}-pending-title`}>Invitations</h3><button className="btn ghost sm" onClick={refreshInvitations} disabled={invitationsLoading || !!busy}>{invitationsLoading ? 'Loading…' : 'Refresh'}</button></div>
      {invitationsError && <p className="err" role="alert">{invitationsError}</p>}
      {!invitationsLoading && !invitationsError && !invitations.length && <p className="saas-empty-note">No invitations yet. Create one above to bring someone into your workspace.</p>}
      <div className="saas-invitation-list">{invitations.map((invitation) => {
        const status = invitationStatus(invitation)
        return <div key={invitation.id} className="saas-invitation-row"><div><strong>{invitation.email}</strong><span>{roleLabel(invitation.role)}{status.label === 'Pending' ? ` · Expires ${dateLabel(invitation.expires_at)}` : ` · Created ${dateLabel(invitation.created_at)}`}</span></div>
          <span className={'pill ' + status.tone}>{status.label}</span>
          {status.label === 'Pending' && <button className="btn ghost sm" onClick={() => revoke(invitation)} disabled={!!busy}>{busy === invitation.id ? 'Revoking…' : 'Revoke'}</button>}
        </div>
      })}</div>
    </section>}
    <div className="settings-context-note"><Shield /><p>{owner ? 'Owners manage invitations and workspace roles. Team members manage their own account passwords.' : 'A workspace owner can invite new people. You can manage access for the team roles your membership permits.'}</p></div>
  </div>
}
