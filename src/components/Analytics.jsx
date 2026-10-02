import { useMemo } from 'react'
import { useApp } from '../App.jsx'
import { isOverdue, isToday } from '../lib/db'
import { SOURCE_CHANNELS, journeyPill, displayLeadTypeKey, displayLeadTypeLabelForKey, displayLeadTypePillForKey } from '../lib/constants'
import { workspaceTerminology, workspaceStageLabel, workspaceStageOptions } from '../lib/workspace'
import { Chart } from '../lib/icons.jsx'

const PILL_VAR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--ink-3)',
}

function MeterRow({ label, value, max, colour }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="meter-row">
      <span className="ml">{label}</span>
      <div className="meter">
        <i style={{ width: pct + '%', ...(colour ? { background: colour } : {}) }} />
      </div>
      <span className="mv">{value}</span>
    </div>
  )
}

function Panel({ title, rows }) {
  return (
    <section className="panel">
      <div className="panel-h">{title}</div>
      {rows.length ? (
        rows.map((r) => (
          <MeterRow key={r.key} label={r.label} value={r.value} max={r.max} colour={r.colour} />
        ))
      ) : (
        <div className="empty">
          <Chart style={{ width: 24, height: 24, opacity: 0.4 }} />
          <p>Nothing to show yet.</p>
        </div>
      )}
    </section>
  )
}

export default function Analytics({ leads }) {
  const { profilesById, leadTypes, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const ls = leads || []

  const kpis = useMemo(() => {
    const total = ls.length
    const qualified = ls.filter((l) => l.qualStatus === 'Qualified').length
    const won = ls.filter((l) => l.journeyStatus === 'Closed Won').length
    const lost = ls.filter((l) => l.journeyStatus === 'Closed Lost').length
    const decided = won + lost
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : null
    const due = ls.filter((l) => isOverdue(l.followupDate) || isToday(l.followupDate)).length

    const scores = ls
      .filter((l) => l.score !== '' && l.score != null)
      .map((l) => Number(l.score))
      .filter((n) => Number.isFinite(n))
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null

    const reachable = ls.filter((l) => l.phone || l.email).length

    return { total, qualified, winRate, due, avgScore, reachable }
  }, [ls])

  const pct = (n) => (kpis.total > 0 ? Math.round((n / kpis.total) * 100) : 0)

  // ── pipeline ──────────────────────────────────────────────────────────────
  const pipeline = useMemo(() => {
    const rows = [
      { key: 'new', label: 'Not yet contacted', value: ls.filter((l) => l.qualStatus === 'Not Yet Contacted').length },
      { key: 'qualified', label: 'Qualified', value: ls.filter((l) => l.qualStatus === 'Qualified').length },
      { key: 'followup', label: workspaceStageLabel(workspace, 'Follow-up Ongoing'), value: ls.filter((l) => l.journeyStatus === 'Follow-up Ongoing').length },
      { key: 'won', label: workspaceStageLabel(workspace, 'Closed Won'), value: ls.filter((l) => l.journeyStatus === 'Closed Won').length },
    ]
    const max = Math.max(0, ...rows.map((row) => row.value))
    return rows.map((row) => ({ ...row, max }))
  }, [ls, workspace])

  // ── lead sources ────────────────────────────────────────────────────────────
  const sources = useMemo(() => {
    const map = new Map()
    for (const l of ls) {
      const chan = SOURCE_CHANNELS.find((c) => c.v && c.v === l.sourceChannel)
      const label = chan ? chan.l : (l.source && String(l.source).trim()) || 'Unknown'
      map.set(label, (map.get(label) || 0) + 1)
    }
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1])
    const max = Math.max(0, ...rows.map((r) => r[1]))
    return rows.map(([label, value]) => ({ key: label, label, value, max }))
  }, [ls])

  // ── stage breakdown ───────────────────────────────────────────────────────
  const stages = useMemo(() => {
    const rows = workspaceStageOptions(workspace, ls.map((lead) => lead.journeyStatus)).map(({ value: stage, label }) => ({
      stage, label,
      value: ls.filter((l) => (l.journeyStatus || 'New Lead') === stage).length,
    }))
    const max = Math.max(0, ...rows.map((r) => r.value))
    return rows.map((r) => ({
      key: r.stage,
      label: r.label,
      value: r.value,
      max,
      colour: PILL_VAR[journeyPill(r.stage)] || 'var(--brand-fg)',
    }))
  }, [ls, workspace])

  // ── team workload ─────────────────────────────────────────────────────────
  const team = useMemo(() => {
    const map = new Map()
    for (const l of ls) {
      const name = (l.assignedTo && profilesById[l.assignedTo]?.name) || 'Unassigned'
      map.set(name, (map.get(name) || 0) + 1)
    }
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1])
    const max = Math.max(0, ...rows.map((r) => r[1]))
    return rows.map(([label, value]) => ({ key: label, label, value, max }))
  }, [ls, profilesById])

  // ── leads by type ──────────────────────────────────────────────────────────
  const byType = useMemo(() => {
    const map = new Map()
    for (const l of ls) {
      const key = displayLeadTypeKey(l)
      map.set(key, (map.get(key) || 0) + 1)
    }
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1])
    const max = Math.max(0, ...rows.map((r) => r[1]))
    return rows.map(([key, value]) => ({
      key,
      label: displayLeadTypeLabelForKey(key, leadTypes),
      value,
      max,
      colour: PILL_VAR[displayLeadTypePillForKey(key, leadTypes)] || 'var(--brand-fg)',
    }))
  }, [ls, leadTypes])

  // ── top attribution (campaigns / ads / forms) ──────────────────────────────
  const attribution = useMemo(() => {
    const topBy = (field) => {
      const map = new Map()
      for (const l of ls) {
        const v = l[field] && String(l[field]).trim()
        if (!v) continue
        map.set(v, (map.get(v) || 0) + 1)
      }
      const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      const max = Math.max(0, ...rows.map((r) => r[1]))
      return rows.map(([label, value]) => ({ key: label, label, value, max }))
    }
    return {
      campaigns: topBy('campaignName'),
      ads: topBy('adName'),
      forms: topBy('formName'),
    }
  }, [ls])

  return (
    <>
      <div className="page-head">
        <span>
          <span className="ttl">Analytics</span>
          <p className="sub">A live snapshot of your pipeline, updated as {terms.records} change.</p>
        </span>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="n">{kpis.total}</div>
          <div className="l">Total {terms.records}</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.qualified}</div>
          <div className="l">Qualified</div>
          <div className="d up">{pct(kpis.qualified)}% of all {terms.records}</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.winRate == null ? '—' : kpis.winRate + '%'}</div>
          <div className="l">Conversion rate</div>
          <div className="d">Successful vs. unsuccessful outcomes</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.due}</div>
          <div className="l">Follow-ups due</div>
          <div className={'d ' + (kpis.due > 0 ? 'down' : '')}>Overdue or today</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.avgScore == null ? '—' : kpis.avgScore}</div>
          <div className="l">Avg score</div>
          <div className="d">Out of 100</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.reachable}</div>
          <div className="l">Contactable</div>
          <div className="d up">{pct(kpis.reachable)}% have contact details</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12,
          marginTop: 18,
        }}
      >
        <Panel title="Pipeline" rows={pipeline} />
        <Panel title={`${terms.recordSingular} sources`} rows={sources} />
        <Panel title="Stage breakdown" rows={stages} />
        <Panel title="Team workload" rows={team} />
        <Panel title={`${terms.recordPlural} by category`} rows={byType} />
        <Panel title="Top campaigns" rows={attribution.campaigns} />
        <Panel title="Top ads" rows={attribution.ads} />
        <Panel title="Top forms" rows={attribution.forms} />
      </div>
    </>
  )
}
