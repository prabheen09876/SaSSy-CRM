import { useEffect, useMemo, useState } from 'react'
import { QUAL, JOURNEY, PRIORITIES, ACTIVITY_TYPES, qualPill, journeyPill, priorityPill, displayLeadTypeKey, displayLeadTypeLabel, displayLeadTypePill, displayLeadTypeOptions } from '../lib/constants'
import { isToday, loadRecentActivities, fmtDate, initials, loadLead, loadActivities, addActivity, loadLeadExport, importedAssignee } from '../lib/db'
import { Search, Plus, Check, Activity, X } from '../lib/icons.jsx'
import { useApp } from '../App.jsx'
import { exportLeads } from '../lib/xlsx'
import { workspaceStageLabel, workspaceStageOptions, workspaceTerminology } from '../lib/workspace'
import LeadsTable, { SORT_COLUMNS } from './LeadsTable.jsx'
import ImportModal from './ImportModal.jsx'

function RecentActivity({ leads, onOpen }) {
  const { profilesById, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const [recent, setRecent] = useState([])
  // refetch when the lead count changes (a new lead logs a 'System' activity) so the feed stays live
  useEffect(() => {
    let alive = true
    loadRecentActivities(12).then((r) => { if (alive) setRecent(r || []) }).catch(() => {})
    return () => { alive = false }
  }, [leads?.length])
  const nameById = useMemo(() => Object.fromEntries((leads || []).map((l) => [l.id, l.name])), [leads])
  if (!recent.length) return null
  return (
    <section className="panel">
      <div className="panel-h"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Activity /> Recent activity</span></div>
      <div className="stack" style={{ gap: 0 }}>
        {recent.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', gap: 10, padding: '10px 4px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
            <span className={'tag ' + (a.type || 'Other')} style={{ marginBottom: 0, height: 'fit-content' }}>{a.type}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                <button className="lead-name" onClick={() => onOpen(a.lead_id)}>{a.leadName || nameById[a.lead_id] || terms.recordSingular}</button>
                <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                  {fmtDate(a.at)} · {new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {profilesById[a.by]?.name ? ' · ' + profilesById[a.by].name : ''}
                </span>
              </div>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.notes}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// Top campaign / ad / form by lead volume — the multi-channel "what's working" panel.
function TopPerformers({ leads }) {
  const topBy = (key, n = 3) => {
    const m = {}
    for (const l of leads) { const v = (l[key] || '').trim(); if (v) m[v] = (m[v] || 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
  }
  const groups = [['Top campaigns', 'campaignName'], ['Top ads', 'adName'], ['Top forms', 'formName']]
  if (!groups.some(([, k]) => topBy(k, 1).length)) return null
  return (
    <section className="panel">
      <div className="panel-h">Top performers</div>
      {groups.map(([label, key]) => {
        const rows = topBy(key)
        if (!rows.length) return null
        return (
          <div key={key} style={{ marginTop: 8 }}>
            <div className="faint" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
            {rows.map(([name, count]) => (
              <div key={name} className="row-between" style={{ padding: '2px 0', fontSize: 12.5, gap: 10 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span className="faint" style={{ flexShrink: 0 }}>{count}</span>
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}

const STATS = [
  { k: 'never', l: 'Never contacted', c: 'var(--warning)', f: (l) => l.qualStatus === 'Not Yet Contacted' },
  { k: 'qual',  l: 'Qualified',       c: 'var(--success)', f: (l) => l.qualStatus === 'Qualified' },
  { k: 'unqual',l: 'Unqualified',     c: 'var(--danger)',  f: (l) => l.qualStatus === 'Unqualified' },
  { k: 'today', l: 'Follow-up today', c: 'var(--info)',    f: (l) => isToday(l.followupDate) },
  { k: 'fo',    stage: 'Follow-up Ongoing', c: 'var(--ink-2)',   f: (l) => l.journeyStatus === 'Follow-up Ongoing' },
  { k: 'unres', stage: 'Unresponsive',      c: 'var(--info)',    f: (l) => l.journeyStatus === 'Unresponsive' },
  { k: 'won',   stage: 'Closed Won',        c: 'var(--success)', f: (l) => l.journeyStatus === 'Closed Won' },
  { k: 'lost',  stage: 'Closed Lost',       c: 'var(--danger)',  f: (l) => l.journeyStatus === 'Closed Lost' },
]

const dateKey = (value, local = false) => {
  if (!value) return ''
  if (!local) return String(value).slice(0, 10)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const inDateRange = (value, from, to, local = false) => {
  if (!from && !to) return true
  const key = dateKey(value, local)
  return !!key && (!from || key >= from) && (!to || key <= to)
}

const HoverRow = ({ label, value }) => (
  <div className="row-between" style={{ padding: '3px 0', fontSize: 12.5, gap: 10 }}>
    <span className="faint" style={{ flexShrink: 0 }}>{label}</span>
    <span style={{ fontWeight: 500, textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
  </div>
)

// Hover preview in the sidebar with business context and recent activity.
function LeadHoverCard({ lead, pinned = false, onUnpin }) {
  const { can, profilesById, leadTypes, patchLead, notify, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const staffName = (id) => profilesById[id]?.name || ''
  const [l, setL] = useState(lead)
  const [acts, setActs] = useState([])
  const [remarks, setRemarks] = useState(lead.remarks || '')
  const [updateType, setUpdateType] = useState(ACTIVITY_TYPES[0])
  const [updateNotes, setUpdateNotes] = useState('')
  const [loadingDetail, setLoadingDetail] = useState(true)
  const [savingUpdate, setSavingUpdate] = useState(false)
  const [savingRemarks, setSavingRemarks] = useState(false)
  const canEdit = can('leads.edit')
  useEffect(() => {
    let alive = true
    setL(lead); setActs([]); setRemarks(lead.remarks || ''); setUpdateNotes(''); setLoadingDetail(true)
    loadLead(lead.id).then((f) => {
      if (alive && f) { setL(f); setRemarks(f.remarks || '') }
    }).catch(() => {}).finally(() => { if (alive) setLoadingDetail(false) })
    loadActivities(lead.id).then((a) => { if (alive) setActs(a || []) }).catch(() => {})
    return () => { alive = false }
  }, [lead.id])

  const onAddUpdate = async (event) => {
    event.preventDefault()
    const notes = updateNotes.trim()
    if (!notes || savingUpdate) return
    setSavingUpdate(true)
    try {
      const at = new Date().toISOString()
      const activity = await addActivity(lead.id, { type: updateType, notes, at })
      setActs((current) => [activity, ...current])
      setUpdateNotes('')
      patchLead(lead.id, { lastActivity: (activity.at || at).slice(0, 10) })
      notify('Update added')
    } catch (error) {
      notify('Could not add update: ' + error.message, true)
    } finally {
      setSavingUpdate(false)
    }
  }

  const onSaveRemarks = async () => {
    if (savingRemarks) return
    setSavingRemarks(true)
    const saved = await patchLead(lead.id, { remarks })
    if (saved) {
      setL((current) => ({ ...current, remarks }))
      notify('Remarks saved')
    }
    setSavingRemarks(false)
  }
  const Head = ({ children }) => <div className="faint" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', margin: '8px 0 4px' }}>{children}</div>
  return (
    <section className={'panel lead-preview' + (pinned ? ' pinned' : '')}>
      {pinned && (
        <div className="lead-preview-pinbar">
          <span><span className="lead-preview-pin-dot" /> Quick edit pinned</span>
          <button type="button" className="icon-btn" onClick={onUnpin} aria-label={`Close pinned ${terms.record}`} title={`Close pinned ${terms.record}`}><X /></button>
        </div>
      )}
      <div className="phead" style={{ gap: 10, marginBottom: 8 }}>
        <div className="avatar sm">{initials(l.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="pname" style={{ fontSize: 15 }}>{l.name || 'Unnamed'}</div>
          <div className="pcontact" style={{ fontSize: 12 }}>{[l.phone, l.email].filter(Boolean).join(' · ') || 'No contact'}</div>
        </div>
      </div>
      <div className="pbadges" style={{ marginBottom: 6 }}>
        <span className={'pill ' + displayLeadTypePill(l, leadTypes)}>{displayLeadTypeLabel(l, leadTypes)}</span>
        <span className={'pill ' + qualPill(l.qualStatus)}><span className="dot" />{l.qualStatus}</span>
        <span className={'pill ' + journeyPill(l.journeyStatus)}><span className="dot" />{workspaceStageLabel(workspace, l.journeyStatus)}</span>
        {l.priority && <span className={'pill ' + priorityPill(l.priority)}><span className="dot" />{l.priority}</span>}
      </div>
      {(l.aiScore || l.score) && <HoverRow label={l.aiScore ? 'AI score' : 'Score'} value={l.aiScore || l.score} />}
      {l.aiSummary && <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '4px 0 6px' }}>{l.aiSummary}</p>}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
        <HoverRow label="Follow-up" value={l.followupDate ? fmtDate(l.followupDate) + (l.followupTime ? ' ' + l.followupTime : '') : '—'} />
        <HoverRow label="Assigned" value={staffName(l.assignedTo) || 'Unassigned'} />
        <HoverRow label="Source" value={l.source || l.sourceChannel || '—'} />
        {l.company && <HoverRow label="Company" value={l.company} />}
        {l.interest && <HoverRow label="Interested in" value={l.interest} />}
        {l.city && <HoverRow label="City" value={l.city} />}
        {l.expectedCloseDate && <HoverRow label="Expected close" value={l.expectedCloseDate} />}
        <HoverRow label="Added" value={fmtDate(l.createdAt) + (staffName(l.createdBy) ? ' · ' + staffName(l.createdBy) : '')} />
      </div>
      {pinned && canEdit && (
        <div className="lead-preview-editor">
          <Head>Add update</Head>
          <form onSubmit={onAddUpdate}>
            <select value={updateType} onChange={(event) => setUpdateType(event.target.value)} aria-label="Update type">
              {ACTIVITY_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
            <textarea value={updateNotes} onChange={(event) => setUpdateNotes(event.target.value)}
              placeholder={`What happened with this ${terms.record}?`} rows="3" aria-label="Update notes" />
            <button type="submit" className="btn primary sm" disabled={savingUpdate || !updateNotes.trim()}>
              <Plus /> {savingUpdate ? 'Adding…' : 'Add update'}
            </button>
          </form>
        </div>
      )}
      {pinned && canEdit ? (
        <div className="lead-preview-editor">
          <Head>Remarks</Head>
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)}
            placeholder="Add an internal remark…" rows="4" aria-label={`${terms.recordSingular} remarks`}
            disabled={loadingDetail || savingRemarks} />
          <button type="button" className="btn ghost sm" onClick={onSaveRemarks}
            disabled={loadingDetail || savingRemarks || remarks === (l.remarks || '')}>
            <Check /> {savingRemarks ? 'Saving…' : 'Save remarks'}
          </button>
        </div>
      ) : l.remarks && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <Head>Remarks</Head>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{l.remarks}</div>
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--line)' }}>
        <Head>Activity log</Head>
        {acts.length === 0 ? (
          <div className="faint" style={{ fontSize: 12 }}>No activity logged yet.</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {acts.slice(0, 8).map((a) => (
              <div key={a.id}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                  <span className={'tag ' + (a.type || 'Other')} style={{ marginBottom: 0, fontSize: 10, padding: '0 5px' }}>{a.type}</span>
                  <span className="faint" style={{ fontSize: 11 }}>{fmtDate(a.at)}{staffName(a.by) ? ' · ' + staffName(a.by) : ''}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.notes}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default function Dashboard({ leads, onOpen }) {
  const { reload, notify, setSearch, dashboardState, setDashboardState, pinnedLeadId, setPinnedLeadId, profiles, leadTypes, can, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const {
    search, qf, jf, af, tf, pf, followupPreset, addedPreset,
    followupFrom, followupTo, addedFrom, addedTo, sf, sortKey, sortDirection,
  } = dashboardState
  const stageOptions = workspaceStageOptions(workspace, [...leads.map((lead) => lead.journeyStatus), jf !== 'All' ? jf : ''])
  const setDashboardField = (field, value) => setDashboardState((current) => ({
    ...current,
    [field]: typeof value === 'function' ? value(current[field]) : value,
  }))
  const setQf = (value) => setDashboardField('qf', value)
  const setJf = (value) => setDashboardField('jf', value)
  const setAf = (value) => setDashboardField('af', value)
  const setTf = (value) => setDashboardField('tf', value)
  const setPf = (value) => setDashboardField('pf', value)
  const setFollowupPreset = (value) => setDashboardField('followupPreset', value)
  const setAddedPreset = (value) => setDashboardField('addedPreset', value)
  const setFollowupFrom = (value) => setDashboardField('followupFrom', value)
  const setFollowupTo = (value) => setDashboardField('followupTo', value)
  const setAddedFrom = (value) => setDashboardField('addedFrom', value)
  const setAddedTo = (value) => setDashboardField('addedTo', value)
  const setSf = (value) => setDashboardField('sf', value)
  const [showImport, setShowImport] = useState(false)
  const [hoverLead, setHoverLead] = useState(null)
  const [exporting, setExporting] = useState(false)
  const typeOptions = displayLeadTypeOptions(leadTypes)
  const pinnedLead = pinnedLeadId ? leads.find((lead) => String(lead.id) === String(pinnedLeadId)) : null
  // A pinned workbench wins over hover so an in-progress note cannot be
  // replaced (and lost) just because the pointer crosses another row.
  const previewLead = pinnedLead || hoverLead

  useEffect(() => {
    if (pinnedLeadId && leads.length && !pinnedLead) setPinnedLeadId(null)
  }, [pinnedLeadId, pinnedLead, leads.length, setPinnedLeadId])

  // date buckets for the multi-channel summary tiles (local time, from createdAt)
  const now = new Date()
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0)
  const yest0 = new Date(today0); yest0.setDate(yest0.getDate() - 1)
  const week0 = new Date(today0); week0.setDate(week0.getDate() - 6)
  const month0 = new Date(today0); month0.setDate(month0.getDate() - 29)
  const weekAhead = new Date(today0); weekAhead.setDate(weekAhead.getDate() + 6)
  const todayKey = dateKey(today0, true)
  const yesterdayKey = dateKey(yest0, true)
  const weekKey = dateKey(week0, true)
  const monthKey = dateKey(month0, true)
  const weekAheadKey = dateKey(weekAhead, true)
  const createdAt = (l) => (l.createdAt ? new Date(l.createdAt) : null)
  const countType = (key) => leads.filter((l) => displayLeadTypeKey(l) === key).length
  const countSince = (from, to) => leads.filter((l) => { const d = createdAt(l); return d && d >= from && (!to || d < to) }).length
  // Total + the headline categories + time windows (brief's dashboard metrics)
  const SUMMARY = [
    { k: null,           l: `Total ${terms.records}`, c: 'var(--brand-fg)', n: leads.length },
    ...typeOptions.filter((type) => type.active !== false).slice(0, 6).map((type) => ({
      k: type.key, l: type.label, c: 'var(--brand-fg)', n: countType(type.key),
    })),
    { k: '__today',      l: `Today's ${terms.records}`, c: 'var(--brand-fg)', n: countSince(today0) },
    { k: '__yest',       l: 'Yesterday',    c: 'var(--ink-2)',   n: countSince(yest0, today0) },
    { k: '__week',       l: 'Last 7 days',  c: 'var(--ink-2)',   n: countSince(week0) },
  ]

  // resolved owner: real assigned_to profile name, else the imported name in remarks
  const assigneeName = (l) =>
    (profiles || []).find((p) => p.id === l.assignedTo)?.name || importedAssignee(l.remarks)

  // owners present anywhere (team profiles + imported names) for the filter dropdown
  const assigneeOptions = useMemo(() => {
    const set = new Set()
    for (const p of profiles || []) if (p.name) set.add(p.name)
    for (const l of leads) { const n = assigneeName(l); if (n) set.add(n) }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [leads, profiles])

  const filtered = useMemo(() => {
    let l = leads
    if (search) {
      const q = search.toLowerCase()
      l = l.filter((x) =>
        (x.name || '').toLowerCase().includes(q) ||
        (x.email || '').toLowerCase().includes(q) ||
        (x.phone || '').toLowerCase().includes(q) ||
        (x.company || '').toLowerCase().includes(q) ||
        (x.interest || '').toLowerCase().includes(q))
    }
    if (qf !== 'All') l = l.filter((x) => x.qualStatus === qf)
    if (jf !== 'All') l = l.filter((x) => x.journeyStatus === jf)
    if (af !== 'All') l = af === '__unassigned__'
      ? l.filter((x) => !assigneeName(x))
      : l.filter((x) => assigneeName(x) === af)
    if (tf !== 'all') l = l.filter((x) => displayLeadTypeKey(x) === tf)
    if (pf !== 'All') l = pf === '__none__'
      ? l.filter((x) => !x.priority)
      : l.filter((x) => x.priority === pf)
    if (followupPreset === 'today') l = l.filter((x) => dateKey(x.followupDate) === todayKey)
    if (followupPreset === 'overdue') l = l.filter((x) => { const d = dateKey(x.followupDate); return d && d < todayKey })
    if (followupPreset === 'next7') l = l.filter((x) => inDateRange(x.followupDate, todayKey, weekAheadKey))
    if (followupPreset === 'none') l = l.filter((x) => !x.followupDate)
    if (followupPreset === 'custom') l = l.filter((x) => inDateRange(x.followupDate, followupFrom, followupTo))
    if (addedPreset === 'today') l = l.filter((x) => dateKey(x.createdAt, true) === todayKey)
    if (addedPreset === 'yesterday') l = l.filter((x) => dateKey(x.createdAt, true) === yesterdayKey)
    if (addedPreset === 'last7') l = l.filter((x) => inDateRange(x.createdAt, weekKey, todayKey, true))
    if (addedPreset === 'last30') l = l.filter((x) => inDateRange(x.createdAt, monthKey, todayKey, true))
    if (addedPreset === 'custom') l = l.filter((x) => inDateRange(x.createdAt, addedFrom, addedTo, true))
    if (sf) { const s = STATS.find((s) => s.k === sf); if (s) l = l.filter(s.f) }

    const priorityRank = { Low: 1, Medium: 2, High: 3 }
    const sortValue = (lead) => {
      if (sortKey === 'name') return lead.name || ''
      if (sortKey === 'type') return displayLeadTypeLabel(lead, leadTypes)
      if (sortKey === 'qualification') return QUAL.indexOf(lead.qualStatus)
      if (sortKey === 'stage') return JOURNEY.indexOf(lead.journeyStatus)
      if (sortKey === 'followup') return lead.followupDate
        ? Date.parse(`${lead.followupDate}T${lead.followupTime || '00:00'}`)
        : null
      if (sortKey === 'assigned') return assigneeName(lead)
      if (sortKey === 'priority') return priorityRank[lead.priority] || null
      return lead.createdAt ? Date.parse(lead.createdAt) : null
    }
    const missing = (value) => value === null || value === undefined || value === '' || value === -1 || (typeof value === 'number' && !Number.isFinite(value))
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...l].sort((a, b) => {
      const aValue = sortValue(a)
      const bValue = sortValue(b)
      const aMissing = missing(aValue)
      const bMissing = missing(bValue)
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      if (!aMissing) {
        const diff = typeof aValue === 'number' && typeof bValue === 'number'
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' })
        if (diff) return diff * direction
      }
      // Deterministic tie-breaker keeps rows from appearing to jump at random.
      const addedDiff = (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
      return addedDiff || String(a.id || '').localeCompare(String(b.id || ''))
    })
  }, [leads, search, qf, jf, af, tf, pf, followupPreset, addedPreset, followupFrom, followupTo, addedFrom, addedTo, sf, sortKey, sortDirection, profiles, leadTypes, todayKey, yesterdayKey, weekKey, monthKey, weekAheadKey])

  const changeSort = (key) => {
    const preferredDirection = { added: 'desc', followup: 'asc', priority: 'desc' }[key] || 'asc'
    setDashboardState((current) => ({
      ...current,
      sortKey: key,
      sortDirection: current.sortKey === key
        ? (current.sortDirection === 'asc' ? 'desc' : 'asc')
        : preferredDirection,
    }))
  }

  const cleared = !sf && qf === 'All' && jf === 'All' && af === 'All' && tf === 'all' && pf === 'All'
    && followupPreset === 'all' && addedPreset === 'all' && !search

  const clearFilters = () => {
    setDashboardState((current) => ({
      ...current,
      search: '', qf: 'All', jf: 'All', af: 'All', tf: 'all', pf: 'All', sf: null,
      followupPreset: 'all', addedPreset: 'all',
      followupFrom: '', followupTo: '', addedFrom: '', addedTo: '',
    }))
  }

  const handleExport = async () => {
    if (exporting) return
    if (!filtered.length) {
      notify(`There are no matching ${terms.records} to export`)
      return
    }
    setExporting(true)
    try {
      let exportRows = filtered
      if (can('leads.export')) {
        const detailedRows = await loadLeadExport()
        const detailsById = new Map(detailedRows.map((lead) => [String(lead.id), lead]))
        // Managers receive the audited detail payload, but it is reordered to
        // exactly match the filters and sorting reviewed on screen.
        exportRows = filtered.map((lead) => detailsById.get(String(lead.id)) || lead)
      }
      await exportLeads(exportRows, leadTypes, workspace)
      const activityCount = exportRows.reduce((sum, lead) => sum + (lead.activities?.length || 0), 0)
      notify(activityCount
        ? `Exported ${exportRows.length} displayed ${exportRows.length === 1 ? terms.record : terms.records} and ${activityCount} activity log entries`
        : `Exported ${exportRows.length} displayed ${exportRows.length === 1 ? terms.record : terms.records}`)
    } catch (error) {
      notify('Export failed: ' + error.message, true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      {/* compact multi-channel summary strip (thin — type tiles filter, time tiles inform) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '0 0 12px' }}>
        {SUMMARY.map((s) => {
          const clickable = !!s.k && !s.k.startsWith('__')   // lead-type chips filter; time chips are display-only
          const active = clickable && tf === s.k
          return (
            <button key={s.l} type="button" aria-pressed={active}
              onClick={() => { if (s.k === null) setTf('all'); else if (clickable) setTf(active ? 'all' : s.k) }}
              style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '4px 11px', borderRadius: 999,
                border: '1px solid ' + (active ? 'var(--brand-fg)' : 'var(--line)'),
                background: active ? 'var(--surface-2)' : 'transparent',
                cursor: clickable ? 'pointer' : 'default', fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap',
              }}>
              <span style={{ fontWeight: 700, color: s.c, fontSize: 13.5 }}>{s.n}</span>
              <span>{s.l}</span>
            </button>
          )
        })}
      </div>

      <div className="stats">
        {STATS.map((s) => (
          <button key={s.k} className="stat" aria-pressed={sf === s.k}
            onClick={() => setSf(sf === s.k ? null : s.k)}>
            <div className="n" style={{ color: s.c }}>{leads.filter(s.f).length}</div>
            <div className="l">{s.stage ? workspaceStageLabel(workspace, s.stage) : s.l}</div>
            <div className="bar" style={{ background: s.c }} />
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search dash-search">
          <Search />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company, interest or contact…" aria-label={`Search ${terms.records}`} />
        </div>
        <select className="select" value={qf} onChange={(e) => setQf(e.target.value)} aria-label="Filter by qualification">
          <option value="All">Qualification: all</option>
          {QUAL.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="select" value={jf} onChange={(e) => setJf(e.target.value)} aria-label="Filter by stage">
          <option value="All">Stage: all</option>
          {stageOptions.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select>
        <select className="select" value={af} onChange={(e) => setAf(e.target.value)} aria-label="Filter by assigned owner">
          <option value="All">Assigned: all</option>
          {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="__unassigned__">Unassigned</option>
        </select>
        <select className="select" value={tf} onChange={(e) => setTf(e.target.value)} aria-label={`Filter by ${terms.record} type`}>
          <option value="all">Type: all</option>
          {typeOptions.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="select" value={pf} onChange={(e) => setPf(e.target.value)} aria-label="Filter by priority">
          <option value="All">Priority: all</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__none__">No priority</option>
        </select>
        <select className="select" value={followupPreset} onChange={(e) => setFollowupPreset(e.target.value)} aria-label="Filter by follow-up date">
          <option value="all">Follow-up: any date</option>
          <option value="today">Follow-up: today</option>
          <option value="overdue">Follow-up: overdue</option>
          <option value="next7">Follow-up: next 7 days</option>
          <option value="none">Follow-up: not scheduled</option>
          <option value="custom">Follow-up: custom range…</option>
        </select>
        <select className="select" value={addedPreset} onChange={(e) => setAddedPreset(e.target.value)} aria-label="Filter by added date">
          <option value="all">Added: any time</option>
          <option value="today">Added: today</option>
          <option value="yesterday">Added: yesterday</option>
          <option value="last7">Added: last 7 days</option>
          <option value="last30">Added: last 30 days</option>
          <option value="custom">Added: custom range…</option>
        </select>
        {(followupPreset === 'custom' || addedPreset === 'custom') && (
          <div className="custom-date-filters">
            {followupPreset === 'custom' && (
              <div className="custom-date-filter" role="group" aria-label="Custom follow-up date range">
                <span className="custom-date-title">Follow-up range</span>
                <label><span>From</span><input type="date" value={followupFrom} max={followupTo || undefined}
                  onChange={(e) => setFollowupFrom(e.target.value)} /></label>
                <label><span>Until</span><input type="date" value={followupTo} min={followupFrom || undefined}
                  onChange={(e) => setFollowupTo(e.target.value)} /></label>
              </div>
            )}
            {addedPreset === 'custom' && (
              <div className="custom-date-filter" role="group" aria-label="Custom added date range">
                <span className="custom-date-title">Added range</span>
                <label><span>From</span><input type="date" value={addedFrom} max={addedTo || undefined}
                  onChange={(e) => setAddedFrom(e.target.value)} /></label>
                <label><span>Until</span><input type="date" value={addedTo} min={addedFrom || undefined}
                  onChange={(e) => setAddedTo(e.target.value)} /></label>
              </div>
            )}
          </div>
        )}
        {!cleared && (
          <button className="btn ghost sm" onClick={clearFilters}>
            Clear
          </button>
        )}
        <div className="toolbar-sort" role="group" aria-label={`Sort ${terms.records}`}>
          <select className="select" value={sortKey} onChange={(event) => changeSort(event.target.value)} aria-label={`Sort ${terms.records} by`}>
            {SORT_COLUMNS.map((column) => <option key={column.key} value={column.key}>Sort: {column.label}</option>)}
          </select>
          <button type="button" className="btn ghost sm" onClick={() => changeSort(sortKey)}
            aria-label={`Change to ${sortDirection === 'asc' ? 'descending' : 'ascending'} order`}>
            {sortDirection === 'asc' ? 'ASC ↑' : 'DESC ↓'}
          </button>
        </div>
        <span className="count">{filtered.length} {filtered.length === 1 ? terms.record : terms.records}</span>
        <button className="btn ghost sm" onClick={handleExport} disabled={exporting || !filtered.length}
          aria-label={`Export ${filtered.length} displayed ${filtered.length === 1 ? terms.record : terms.records} in the current sort order`}
          title={`Exports the currently filtered ${terms.records} in the current sort order`}
          style={{ marginLeft: 'auto' }}>
          <Check /> {exporting ? 'Exporting...' : 'Export'}
        </button>
        <button className="btn ghost sm" onClick={() => setShowImport(true)} aria-label={`Import ${terms.records} from spreadsheet`}>
          <Plus /> Import
        </button>
      </div>

      <div className="dash-split">
        <div className="dash-main">
          <LeadsTable
            leads={filtered}
            onOpen={onOpen}
            onHover={setHoverLead}
            selectedLeadId={pinnedLeadId}
            onSelect={(id) => { setPinnedLeadId(id); setHoverLead(null) }}
            sort={{ key: sortKey, direction: sortDirection }}
            onSort={changeSort}
          />
        </div>
        <aside className="dash-side">
          <div style={{ display: previewLead ? 'none' : 'block' }}>
            <TopPerformers leads={leads} />
            <RecentActivity leads={leads} onOpen={onOpen} />
          </div>
          {previewLead && (
            <LeadHoverCard lead={previewLead}
              pinned={String(previewLead.id) === String(pinnedLeadId)}
              onUnpin={() => { setPinnedLeadId(null); setHoverLead(null) }} />
          )}
        </aside>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={(n) => { reload(); notify(`Imported ${n} ${n === 1 ? terms.record : terms.records}`) }}
        />
      )}
    </>
  )
}
