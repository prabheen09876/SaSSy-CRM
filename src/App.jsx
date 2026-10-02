import { useEffect, useLayoutEffect, useState, useCallback, useRef, createContext, useContext } from 'react'
import { supabase, hasConfig, configurationError, isSaas } from './lib/supabase'
import { clearWorkspaceSelection } from './lib/saas'
import ConnectionSettings from './components/ConnectionSettings.jsx'
import SaasTeam from './components/SaasTeam.jsx'
import { loadLeads, loadLeadsRevision, loadProfiles, updateLead, deleteLead, loadNotifications, loadLeadTypes, loadWorkspaceSettings, saveWorkspaceSettings } from './lib/db'
import { readLocalWorkspace, normalizeWorkspace, workspaceTerminology } from './lib/workspace'
import WorkspaceSetup from './components/WorkspaceSetup.jsx'
import Brand from './components/Brand.jsx'
import { can, DEMO_PERSONAS, roleShort, rolePill } from './lib/auth'
import Login from './components/Login.jsx'
import TemporaryPassword from './components/TemporaryPassword.jsx'
import { checkStaffPasswordGate, hasCrmAccess } from './lib/teamAccounts'
import Dashboard from './components/Dashboard.jsx'
import LeadProfile from './components/LeadProfile.jsx'
import AddLeadModal from './components/AddLeadModal.jsx'
import Calendar from './components/Calendar.jsx'
import Reminders from './components/Reminders.jsx'
import Notifications from './components/Notifications.jsx'
import Automations from './components/Automations.jsx'
import Messages from './components/Messages.jsx'
import Analytics from './components/Analytics.jsx'
import Team from './components/Team.jsx'
import Settings from './components/Settings.jsx'
import Bin from './components/Bin.jsx'
import Funnel from './components/Funnel.jsx'
import DailyAnalytics from './components/DailyAnalytics.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { Plus, Logout, Calendar as CalendarIcon, Bell, Zap, Chat, Chart, Settings as SettingsIcon, Users, Trash, Funnel as FunnelIcon, Activity, Search, X, Sun, Moon } from './lib/icons.jsx'
import { attentionCount, dueNow } from './lib/reminders'
import { showReminder } from './lib/notify'
import { subscribeToPush } from './lib/push'
import { useTheme } from './lib/useTheme.js'

export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

const demo = !hasConfig
const DEMO_KEY = 'workspace-crm.demo.me'
const readDemoId = () => { try { return localStorage.getItem(DEMO_KEY) || null } catch { return null } }

// Keep the Leads workspace intact while a profile is open and across a reload in
// this tab. sessionStorage is deliberately used instead of localStorage: the
// state is isolated to this tab, expires with it, and contains filter criteria
// only (never lead records).
const DASHBOARD_STATE_KEY = 'workspace-crm.dashboard-state.v1'
const DASHBOARD_DEFAULTS = Object.freeze({
  search: '',
  qf: 'All',
  jf: 'All',
  af: 'All',
  tf: 'all',
  pf: 'All',
  followupPreset: 'all',
  addedPreset: 'all',
  followupFrom: '',
  followupTo: '',
  addedFrom: '',
  addedTo: '',
  sf: null,
  sortKey: 'added',
  sortDirection: 'desc',
})

const readDashboardState = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DASHBOARD_STATE_KEY) || '{}')
    const next = { ...DASHBOARD_DEFAULTS }
    for (const key of Object.keys(DASHBOARD_DEFAULTS)) {
      const value = saved?.[key]
      if (key === 'sf') {
        if (value === null || (typeof value === 'string' && value.length <= 40)) next[key] = value
      } else if (typeof value === 'string' && value.length <= 200) {
        next[key] = value
      }
    }
    if (!['name', 'type', 'qualification', 'stage', 'followup', 'added', 'assigned', 'priority'].includes(next.sortKey)) next.sortKey = 'added'
    if (!['asc', 'desc'].includes(next.sortDirection)) next.sortDirection = 'desc'
    return next
  } catch {
    return { ...DASHBOARD_DEFAULTS }
  }
}

const visibleLeadListItem = (id) => {
  if (typeof document === 'undefined') return null
  return Array.from(document.querySelectorAll('[data-lead-list-id]')).find((node) =>
    node.dataset.leadListId === String(id) && node.getClientRects().length) || null
}

// Shown when a signed-in auth user has no active profile (deactivated / removed / not provisioned).
function NoAccess({ email, onSignOut }) {
  return (
    <div className="login-wrap"><div className="login" style={{ textAlign: 'center' }}>
      <Brand />
      <p className="lead" style={{ marginTop: 12 }}>This account doesn’t have access.</p>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        {email ? email + ' ' : ''}isn’t active or hasn’t been assigned CRM access{isSaas ? ' in this workspace' : ''}. Ask an owner to review team access.
      </p>
      {isSaas && <button className="btn block" onClick={clearWorkspaceSelection}>Choose another workspace</button>}
      <button className="btn primary block" style={{ marginTop: 16 }} onClick={onSignOut}>Sign out</button>
    </div></div>
  )
}

// nav, in display order. Each tab is shown only if the user has its permission.
const NAV = [
  { view: 'dash',        label: 'Leads',       perm: 'leads.view' },
  { view: 'reminders',   label: 'Reminders',   perm: 'reminders.view',   badge: true },
  { view: 'calendar',    label: 'Calendar',    perm: 'calendar.view',    icon: CalendarIcon },
  { view: 'automations', label: 'Automations', perm: 'automations.view', icon: Zap },
  { view: 'messages',    label: 'Messages',    perm: 'messages.view',    icon: Chat },
  { view: 'funnel',      label: 'Pipeline',    perm: 'leads.view',       icon: FunnelIcon },
  { view: 'analytics',   label: 'Analytics',   perm: 'analytics.view',   icon: Chart },
  { view: 'daily',       label: 'Daily',       perm: 'analytics.view',   icon: Activity },
  { view: 'team',        label: 'Team',        perm: 'team.view',        icon: Users },
  { view: 'bin',         label: 'Bin',         perm: 'leads.delete',     icon: Trash },
  { view: 'settings',    label: 'Settings',    perm: 'account.view',     icon: SettingsIcon },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [passwordGate, setPasswordGate] = useState({ status: 'checking', userId: null })
  const [gateRevision, setGateRevision] = useState(0)
  const [loginMessage, setLoginMessage] = useState('')
  const [demoId, setDemoId] = useState(readDemoId)
  const [leads, setLeads] = useState([])
  const [profiles, setProfiles] = useState([])
  const [leadTypes, setLeadTypes] = useState([])
  const [workspace, setWorkspace] = useState(readLocalWorkspace)
  const terms = workspaceTerminology(workspace)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('dash')
  const [selId, setSelId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [dashboardState, setDashboardState] = useState(readDashboardState)
  const [pinnedLeadId, setPinnedLeadId] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const { resolvedTheme: theme, setPreference: setTheme } = useTheme()
  const [toast, setToast] = useState({ msg: '', err: false, show: false })
  const leadListPositionRef = useRef(null)
  const restoreLeadListPositionRef = useRef(false)
  const currentSessionRef = useRef(null)
  const authorizedUserRef = useRef(null)
  const verifiedTokenRef = useRef(null)
  const profileTokenRef = useRef(null)
  const identityRevisionRef = useRef(0)
  const dataLoadRevisionRef = useRef(0)
  const leadRefreshRequestRef = useRef(0)
  const leadRefreshFailureRef = useRef(0)
  const leadRevisionRef = useRef(null)

  useEffect(() => {
    try { sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify(dashboardState)) } catch {}
  }, [dashboardState])

  // Returning from a lead profile should feel like closing a detail view, not
  // reopening the Leads page. Anchor the selected row/card to the same place in
  // the viewport, with scrollY as a fallback if that lead no longer matches.
  useLayoutEffect(() => {
    if (view !== 'dash' || !restoreLeadListPositionRef.current) return
    restoreLeadListPositionRef.current = false
    const saved = leadListPositionRef.current
    if (!saved) return

    let firstFrame
    let secondFrame
    const restore = () => {
      const item = visibleLeadListItem(saved.leadId)
      if (item && Number.isFinite(saved.viewportTop)) {
        window.scrollBy(0, item.getBoundingClientRect().top - saved.viewportTop)
      } else {
        window.scrollTo(0, saved.scrollY)
      }
    }
    firstFrame = window.requestAnimationFrame(() => {
      restore()
      secondFrame = window.requestAnimationFrame(restore)
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [view])

  const search = dashboardState.search
  const setSearch = useCallback((value) => {
    setDashboardState((current) => ({
      ...current,
      search: typeof value === 'function' ? value(current.search) : String(value ?? ''),
    }))
  }, [])

  const clearDashboardState = () => {
    try { sessionStorage.removeItem(DASHBOARD_STATE_KEY) } catch {}
    setDashboardState({ ...DASHBOARD_DEFAULTS })
    setPinnedLeadId(null)
  }

  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err, show: true })
    clearTimeout(window.__t); window.__t = setTimeout(() => setToast((t) => ({ ...t, show: false })), err ? 5000 : 2400)
  }, [])

  // auth — in demo there's no real session; we gate on a chosen persona instead
  useEffect(() => {
    if (demo) { setAuthReady(true); return }
    let active = true, authEventSeen = false
    const acceptSession = (next) => {
      if (currentSessionRef.current?.user.id !== next?.user.id) {
        authorizedUserRef.current = null; verifiedTokenRef.current = null; profileTokenRef.current = null
        identityRevisionRef.current += 1; dataLoadRevisionRef.current += 1
        setProfiles([]); setLeads([]); setLeadTypes([]); setNotifs([])
        setShowAdd(false); setSelId(null); setToast({ msg: '', err: false, show: false })
        notifiedRef.current = null
        leadRefreshRequestRef.current += 1; leadRefreshFailureRef.current = 0; leadRevisionRef.current = null
      }
      currentSessionRef.current = next; setSession(next)
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (!authEventSeen) acceptSession(data.session)
      setAuthReady(true)
    }).catch(() => { if (active) setAuthReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      if (!active) return
      authEventSeen = true; acceptSession(next); setAuthReady(true)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const saveWorkspace = useCallback(async (settings) => {
    const saved = normalizeWorkspace(await saveWorkspaceSettings(normalizeWorkspace(settings)))
    setWorkspace(saved)
    return saved
  }, [])

  useEffect(() => { document.title = /crm$/i.test(workspace.name) ? workspace.name : `${workspace.name} · CRM` }, [workspace.name])

  // Verify the live gate before any CRM reads, subscriptions or notifications.
  // A refreshed token or explicit retry checks again without polling the Worker.
  useEffect(() => {
    if (demo || !session) return
    let cancelled = false
    const sameAuthorizedUser = authorizedUserRef.current === session.user.id
      && hasCrmAccess(profiles.find((profile) => profile.id === session.user.id))
    const stillCurrent = () => !cancelled && currentSessionRef.current?.access_token === session.access_token
      && currentSessionRef.current?.user.id === session.user.id
    const clearAccess = () => { authorizedUserRef.current = null; profileTokenRef.current = null; setProfiles([]); setLeads([]); setLeadTypes([]); setNotifs([]) }
    dataLoadRevisionRef.current += 1
    verifiedTokenRef.current = null; profileTokenRef.current = null
    setPasswordGate({ status: 'checking', userId: session.user.id, token: session.access_token })
    if (!sameAuthorizedUser) { setLoading(true); clearAccess() }
    checkStaffPasswordGate(supabase).then(({ user, required, recoveryRequired }) => {
      if (!stillCurrent()) return
      if (user.id !== session.user.id) throw new Error('Your account changed. Sign in again.')
      if (required) clearAccess()
      else verifiedTokenRef.current = session.access_token
      setPasswordGate({ status: required ? 'required' : 'clear', recoveryRequired, userId: user.id, token: session.access_token })
    }).catch((error) => {
      if (!stillCurrent()) return
      clearAccess()
      setPasswordGate({ status: 'error', userId: session.user.id, token: session.access_token, message: error.message })
    })
    return () => { cancelled = true }
  }, [session?.access_token, gateRevision])

  const canLoadData = demo ? !!demoId : !!session && verifiedTokenRef.current === session.access_token && passwordGate.token === session.access_token && passwordGate.userId === session.user.id && passwordGate.status === 'clear'
  const dataAllowed = canLoadData && (demo || profileTokenRef.current === session.access_token && hasCrmAccess(profiles.find((profile) => profile.id === session.user.id)))

  const loadAll = useCallback(async ({ background = false } = {}) => {
    if (!canLoadData || (!demo && verifiedTokenRef.current !== session?.access_token)) return
    const revision = ++dataLoadRevisionRef.current
    const token = session?.access_token
    const stillCurrent = () => revision === dataLoadRevisionRef.current
      && (demo || currentSessionRef.current?.access_token === token && verifiedTokenRef.current === token)
    let profileVerified = false
    if (!background) setLoading(true)
    try {
      // Resolve the staff profile first. A CRM data error must not erase a valid
      // identity and incorrectly render the inactive-account screen.
      const p = await loadProfiles()
      if (!stillCurrent()) return
      setProfiles(p)
      if (!demo && !hasCrmAccess(p.find((profile) => profile.id === session?.user.id))) {
        authorizedUserRef.current = null
        verifiedTokenRef.current = null; profileTokenRef.current = null; setLoading(false)
        setLeads([]); setLeadTypes([]); setNotifs([])
        setPasswordGate({ status: 'denied', userId: session.user.id, token })
        return
      }
      profileVerified = true
      if (!demo) { authorizedUserRef.current = session.user.id; profileTokenRef.current = token }
      const [l, lt, ws] = await Promise.all([loadLeads(), loadLeadTypes(), loadWorkspaceSettings()])
      if (!stillCurrent()) return
      setLeads(l); setLeadTypes(lt); setWorkspace(normalizeWorkspace(ws))
    } catch (e) {
      if (!stillCurrent()) return
      if (!demo && !profileVerified) {
        authorizedUserRef.current = null
        verifiedTokenRef.current = null; profileTokenRef.current = null; setLoading(false)
        setProfiles([]); setLeads([]); setLeadTypes([]); setNotifs([])
        setPasswordGate({ status: 'error', userId: session.user.id, token, message: 'Account access could not be verified. Try again.' })
      } else notify('Could not load data: ' + e.message, true)
    } finally { if (stillCurrent()) setLoading(false) }
  }, [notify, canLoadData, session?.access_token, session?.user.id])

  useEffect(() => { if (canLoadData) loadAll({ background: !demo && authorizedUserRef.current === session?.user.id }) }, [canLoadData, loadAll, session?.user.id])

  // Silent background refresh of just the leads (no full-screen spinner). Used by the
  // live-sync effect so a teammate's edit lands without wiping the current view.
  const reloadLeads = useCallback(async () => {
    const request = ++leadRefreshRequestRef.current
    const revision = dataLoadRevisionRef.current, token = currentSessionRef.current?.access_token
    try {
      const next = await loadLeads()
      if (request !== leadRefreshRequestRef.current || revision !== dataLoadRevisionRef.current || token !== currentSessionRef.current?.access_token || (!demo && verifiedTokenRef.current !== token)) return false
      setLeads(next)
      leadRefreshFailureRef.current = 0
      return true
    } catch (error) {
      if (request === leadRefreshRequestRef.current && revision === dataLoadRevisionRef.current && token === currentSessionRef.current?.access_token) {
        leadRefreshFailureRef.current += 1
        console.error('CRM lead refresh failed', error)
        if (leadRefreshFailureRef.current === 3) notify('Lead refresh is temporarily failing. Your existing data is still safe.', true)
      }
      return false
    }
  }, [notify])

  // Poll a small revision token while visible; fetch records only when changed.
  // Focus also forces an immediate check.
  useEffect(() => {
    if (demo || !dataAllowed) return
    let stopped = false
    let t
    const refreshIfChanged = async ({ force = false } = {}) => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const nextRevision = await loadLeadsRevision()
        if (stopped) return
        const changed = leadRevisionRef.current !== null && leadRevisionRef.current !== nextRevision
        if (force || changed) {
          const refreshed = await reloadLeads()
          if (!stopped && refreshed) leadRevisionRef.current = nextRevision
        } else {
          leadRevisionRef.current = nextRevision
        }
      } catch (error) {
        if (!stopped) console.error('CRM lead revision check failed', error)
      }
    }
    const bump = () => {
      clearTimeout(t)
      t = setTimeout(() => { void refreshIfChanged({ force: true }) }, 400)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    bump()
    const poll = setInterval(() => { void refreshIfChanged() }, 20000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      stopped = true
      clearTimeout(t); clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [dataAllowed, reloadLeads])

  // notification feed — loaded on sign-in and polled so the bell badge stays fresh
  const [notifs, setNotifs] = useState([])
  const reloadNotifs = useCallback(async () => {
    const revision = dataLoadRevisionRef.current, token = currentSessionRef.current?.access_token
    try {
      const next = await loadNotifications()
      if (revision === dataLoadRevisionRef.current && token === currentSessionRef.current?.access_token && (demo || verifiedTokenRef.current === token)) setNotifs(next)
    } catch { /* table may not be migrated yet */ }
  }, [])
  useEffect(() => {
    if (!dataAllowed) return
    reloadNotifs()
    const id = setInterval(reloadNotifs, 60000)
    return () => clearInterval(id)
  }, [dataAllowed, reloadNotifs])

  // If this device already granted notifications, make sure its push subscription is
  // saved to the backend (re-runs cheaply on every load; covers the case where the
  // table was created after the user first enabled alerts).
  useEffect(() => {
    if (demo || !dataAllowed) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    subscribeToPush().catch(() => {})
  }, [dataAllowed])

  const refreshProfiles = useCallback(async () => {
    const revision = dataLoadRevisionRef.current, token = currentSessionRef.current?.access_token
    try {
      const next = await loadProfiles()
      if (revision === dataLoadRevisionRef.current && token === currentSessionRef.current?.access_token && (demo || verifiedTokenRef.current === token)) setProfiles(next)
    } catch (e) { if (revision === dataLoadRevisionRef.current && token === currentSessionRef.current?.access_token) notify('Could not refresh team: ' + e.message, true) }
  }, [notify])
  // Account writes may finish during a same-user token refresh. Keep their
  // results, but never deliver an old dialog's response to another sign-in.
  const identityRevision = identityRevisionRef.current
  const applyProfile = useCallback((profile) => {
    const sameIdentity = () => identityRevision === identityRevisionRef.current
      && (demo || currentSessionRef.current?.user.id === session?.user.id && authorizedUserRef.current === session?.user.id)
    if (!sameIdentity()) return
    setProfiles((current) => !sameIdentity() ? current : current.some((item) => item.id === profile.id)
      ? current.map((item) => item.id === profile.id ? { ...item, ...profile } : item)
      : [...current, profile])
  }, [identityRevision, session?.user.id])

  // in-app reminder alerts while the tab is open (always-on ones come from the backend later)
  const notifiedRef = useRef(null)
  useEffect(() => {
    if (!dataAllowed || !leads.length) return
    if (notifiedRef.current === null) notifiedRef.current = new Set(dueNow(leads).map((l) => l.id))
    const tick = () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      const fresh = dueNow(leads).filter((l) => !notifiedRef.current.has(l.id))
      fresh.forEach((l) => notifiedRef.current.add(l.id))
      if (fresh.length === 1) showReminder('CRM reminder', `Follow-up due now: ${fresh[0].name || 'lead'}`)
      else if (fresh.length > 1) showReminder('CRM reminders', `${fresh.length} follow-ups due now`)
    }
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [dataAllowed, leads])

  // Optimistic for snappiness, but REVERT if the write actually fails. Previously the
  // failure was only toasted while the optimistic edit stayed on screen — so a lost write
  // looked saved. Now the Worker verifies the write (errors on 0 rows) and we roll back.
  const patchLead = useCallback(async (id, fields) => {
    let prev = null
    setLeads((ls) => ls.map((l) => { if (l.id === id) { prev = l; return { ...l, ...fields } } return l }))
    try { await updateLead(id, fields); return true }
    catch (e) {
      if (prev) setLeads((ls) => ls.map((l) => (l.id === id ? prev : l)))   // roll back the optimistic edit
      notify('Not saved: ' + e.message, true)
      return false
    }
  }, [notify])

  const removeLead = useCallback(async (id) => {
    let snapshot = null
    setLeads((ls) => { snapshot = ls; return ls.filter((l) => l.id !== id) })
    const prevView = view, prevSel = selId
    if (selId === id) { setView('dash'); setSelId(null) }
    try { await deleteLead(id); notify('Moved to Bin — restore it anytime') }
    catch (e) {
      if (snapshot) setLeads(snapshot)                    // restore the lead we optimistically removed
      if (prevSel === id) { setView(prevView); setSelId(prevSel) }
      notify('Delete failed: ' + e.message, true)
    }
  }, [notify, selId, view])

  // remember which view a lead was opened from, so Back returns there (not always Leads)
  const [backView, setBackView] = useState('dash')
  const [calDay, setCalDay] = useState(null)   // Calendar's open day, kept across lead visits
  const openLead = (id) => {
    if (view !== 'profile') {
      setBackView(view)
      if (view === 'dash') {
        const item = visibleLeadListItem(id)
        leadListPositionRef.current = {
          leadId: String(id),
          viewportTop: item?.getBoundingClientRect().top,
          scrollY: window.scrollY,
        }
      }
    }
    setSelId(id)
    setView('profile')
  }
  const goto = (v) => {
    restoreLeadListPositionRef.current = v === 'dash' && view === 'profile' && backView === 'dash'
    setSelId(null)
    setView(v)
  }

  const profilesById = Object.fromEntries(profiles.map((p) => [p.id, p]))
  const me = demo ? (profilesById[demoId] || null) : (session ? profilesById[session.user.id] : null)
  const due = attentionCount(leads)
  const unreadNotifs = me ? notifs.filter((n) => !(n.read_by || []).includes(me.id)).length : 0
  const ican = useCallback((p) => can(me, p), [me])

  const pickPersona = (id) => { clearDashboardState(); try { localStorage.setItem(DEMO_KEY, id) } catch {} ; setDemoId(id); setView('dash') }
  const signOut = async () => {
    if (!demo) {
      const identity = currentSessionRef.current?.user?.id
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        if (error) throw error
      } catch { notify('Could not sign out. Check your connection and try again.', true); return }
      if (currentSessionRef.current?.user?.id && currentSessionRef.current.user.id !== identity) return
    }
    clearDashboardState()
    currentSessionRef.current = null; authorizedUserRef.current = null; verifiedTokenRef.current = null; profileTokenRef.current = null
    identityRevisionRef.current += 1; dataLoadRevisionRef.current += 1; notifiedRef.current = null
    leadRefreshRequestRef.current += 1; leadRefreshFailureRef.current = 0; leadRevisionRef.current = null
    setSession(null)
    setProfiles([]); setLeads([]); setLeadTypes([]); setNotifs([])
    if (demo) { try { localStorage.removeItem(DEMO_KEY) } catch {} ; setDemoId(null); setView('dash') }
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  // if the active view isn't allowed for this role, fall back to Leads
  useEffect(() => {
    if (!me || view === 'profile') return
    const n = NAV.find((x) => x.view === view)
    if (n && !can(me, n.perm)) setView('dash')
  }, [me, view])

  if (configurationError) return <div className="setup-page"><Brand /><p role="alert">{configurationError}</p><ConnectionSettings /></div>
  if (!authReady) return <div className="center"><div className="spinner" /></div>
  if (demo && !demoId) return <Login demo personas={DEMO_PERSONAS} onPick={pickPersona} notify={notify} />
  if (!demo && !session) return <Login notify={notify} message={loginMessage} />
  const checkingAccount = !demo && (passwordGate.token !== session?.access_token || passwordGate.userId !== session?.user.id || passwordGate.status === 'checking'
    || passwordGate.status === 'clear' && profileTokenRef.current !== session?.access_token)
  const retainedAccount = !demo && session?.user.id === authorizedUserRef.current && hasCrmAccess(me)
  if (checkingAccount && !retainedAccount) return <div className="center"><div className="spinner" /></div>
  if (!demo && passwordGate.status === 'required') return <TemporaryPassword email={session.user.email} recoveryRequired={passwordGate.recoveryRequired} onComplete={(result) => { setLoginMessage(result?.recoveryPending ? 'Password saved; sign in again with your new password to finish setup.' : 'Password saved. Sign in again with your email and new private password.'); signOut() }} onSignOut={signOut} />
  if (!demo && passwordGate.status === 'error') return <div className="login-wrap"><div className="login"><p className="err" role="alert">{passwordGate.message}</p><button className="btn primary block" onClick={() => setGateRevision((value) => value + 1)}>Retry access check</button><button className="btn ghost block" onClick={signOut}>Sign out</button></div></div>
  if (!demo && session && !loading && !hasCrmAccess(me)) return <NoAccess email={session.user?.email} onSignOut={signOut} />

  const tabs = NAV.filter((n) => can(me, n.perm)).map((item) => item.view === 'dash' ? { ...item, label: terms.recordPlural } : item)
  const ctx = { notify, profiles, profilesById, me, can: ican, reload: loadAll, refreshProfiles, applyProfile, patchLead, removeLead, openLead, setLeads, goto, search, setSearch, dashboardState, setDashboardState, pinnedLeadId, setPinnedLeadId, leadTypes, setLeadTypes, workspace, terms, saveWorkspace, demo, saas: isSaas, chooseWorkspace: clearWorkspaceSelection }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell" inert={checkingAccount ? '' : undefined} aria-hidden={checkingAccount || undefined}>
        <header className="topbar">
          <Brand name={workspace.name} />
          {isSaas && <button className="workspace-switch" onClick={clearWorkspaceSelection} aria-label="Switch workspace" title="Switch workspace">
            <span>Switch workspace</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></svg>
          </button>}
          {demo && (
            <span className="demo-badge" title="Sample records reset on reload. Business settings are saved on this device."
              style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                color: 'var(--on-brand)', background: 'var(--on-brand-soft)', border: '1px solid var(--on-brand-line)', whiteSpace: 'nowrap' }}>
              Demo data
            </span>
          )}
          {can(me, 'leads.view') && (
            <div className="topbar-search">
              <Search />
              <input value={search} placeholder={`Search ${terms.records} or companies…`} aria-label={`Search ${terms.records}`}
                onChange={(e) => { setSearch(e.target.value); if (view !== 'dash' && view !== 'profile') goto('dash') }} />
            </div>
          )}
          <div className="topbar-spacer" />
          {can(me, 'leads.add') && (
            <button className="btn primary sm add-lead" aria-label={`Add ${terms.record}`} onClick={() => setShowAdd(true)}><Plus /> <span className="lbl">Add {terms.record}</span></button>
          )}
          {can(me, 'leads.view') && (
            <button className="icon-btn topbar-search-btn" title="Search" aria-label="Search" onClick={() => setSearchOpen(true)}><Search /></button>
          )}
          <button className="icon-btn" title="Notifications" onClick={() => goto('notifications')} style={{ position: 'relative', color: 'var(--on-brand)' }}>
            <Bell />
            {unreadNotifs > 0 && (
              <span style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, padding: '0 4px',
                borderRadius: 999, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 10, fontWeight: 700,
                display: 'grid', placeItems: 'center', lineHeight: 1 }}>{unreadNotifs}</span>
            )}
          </button>
          <span className="who">
            <span className="uname" style={{ fontWeight: 600, color: 'var(--on-brand)' }}>{me?.name || 'You'}</span>
            <span className="role">{roleShort(me?.role)}</span>
            <button className="icon-btn" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} style={{ color: 'var(--brand-ink)' }} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <button className="icon-btn" title={demo ? 'Switch user' : 'Sign out'} style={{ color: 'var(--on-brand-muted)' }}
              onClick={signOut}><Logout /></button>
          </span>
          {searchOpen && can(me, 'leads.view') && (
            <div className="topbar-search-mobile">
              <Search />
              <input autoFocus value={search} placeholder={`Search ${terms.records} or companies…`} aria-label={`Search ${terms.records}`}
                onChange={(e) => { setSearch(e.target.value); if (view !== 'dash' && view !== 'profile') goto('dash') }} />
              <button className="close" aria-label="Close search" onClick={() => setSearchOpen(false)}><X /></button>
            </div>
          )}
        </header>

        <nav className="tabs" role="tablist" aria-label="Sections">
          {tabs.map((n) => {
            const active = n.view === 'dash' ? (view === 'dash' || view === 'profile') : view === n.view
            const Icon = n.icon
            return (
              <button key={n.view} className="tab" role="tab" aria-selected={active} onClick={() => goto(n.view)}>
                {Icon && <Icon width="15" height="15" style={{ verticalAlign: '-2px', marginRight: 5 }} />}
                {n.label}
                {n.badge && due > 0 && (
                  <span style={{ marginLeft: 6, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{due}</span>
                )}
              </button>
            )
          })}
        </nav>

        <main className="content">
          <ErrorBoundary key={view} inline>
          {loading ? (
            <div className="center" style={{ minHeight: '40vh' }}><div className="spinner" /></div>
          ) : !workspace.setupComplete && can(me, 'settings.edit') ? (
            <WorkspaceSetup />
          ) : view === 'profile' ? (
            <LeadProfile lead={leads.find((l) => l.id === selId)} onBack={() => goto(backView)} backLabel={backView === 'dash' ? terms.records : (NAV.find((item) => item.view === backView)?.label || 'workspace').toLowerCase()} />
          ) : view === 'calendar' ? (
            <Calendar leads={leads} onOpen={openLead} day={calDay} setDay={setCalDay} onRefresh={reloadLeads} />
          ) : view === 'reminders' ? (
            <Reminders leads={leads} onOpen={openLead} />
          ) : view === 'notifications' ? (
            <Notifications notifs={notifs} me={me} onOpen={openLead} reload={reloadNotifs} />
          ) : view === 'automations' ? (
            <Automations leads={leads} />
          ) : view === 'messages' ? (
            <Messages leads={leads} onOpen={openLead} />
          ) : view === 'funnel' ? (
            <Funnel leads={leads} onOpen={openLead} />
          ) : view === 'analytics' ? (
            <Analytics leads={leads} />
          ) : view === 'daily' ? (
            <DailyAnalytics leads={leads} />
          ) : view === 'team' ? (
            isSaas ? <SaasTeam /> : <Team />
          ) : view === 'bin' ? (
            <Bin />
          ) : view === 'settings' ? (
            <Settings />
          ) : (
            <Dashboard leads={leads} onOpen={openLead} />
          )}
          </ErrorBoundary>
        </main>

        {showAdd && <AddLeadModal onClose={() => setShowAdd(false)}
          onAdded={(lead) => { setLeads((ls) => [lead, ...ls]); setShowAdd(false) }} />}

        {can(me, 'leads.add') && (
          <button className="fab-add" title={`Add ${terms.record}`} aria-label={`Add ${terms.record}`} onClick={() => setShowAdd(true)}><Plus /></button>
        )}

        <div className={'toast' + (toast.show ? ' show' : '') + (toast.err ? ' err' : '')}>{toast.msg}</div>
      </div>
      {checkingAccount && <div className="overlay"><div className="login" role="status" aria-live="polite"><div className="spinner" /><p>Checking account access…</p></div></div>}
    </AppCtx.Provider>
  )
}
