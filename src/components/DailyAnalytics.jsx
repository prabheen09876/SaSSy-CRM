import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { loadMessages, fmtDate, isToday } from '../lib/db'
import { Chart } from '../lib/icons.jsx'

// Local YYYY-MM-DD key for a Date (avoids UTC drift from toISOString).
const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Short label like "01 Jul".
const shortDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

const RANGES = [7, 14, 30]

export default function DailyAnalytics({ leads }) {
  const { workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const [msgs, setMsgs] = useState([])
  const [days, setDays] = useState(14)

  useEffect(() => {
    let alive = true
    loadMessages().then((m) => { if (alive) setMsgs(m || []) })
    return () => { alive = false }
  }, [])

  const ls = leads || []

  // Build the last N calendar days, most recent first.
  const dayList = useMemo(() => {
    const out = []
    const base = new Date()
    base.setHours(0, 0, 0, 0)
    for (let i = 0; i < days; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() - i)
      out.push(d)
    }
    return out // [today, yesterday, ...]
  }, [days])

  // Bucket counts by local day key.
  const buckets = useMemo(() => {
    const newLeads = {}
    const sent = {}
    const replies = {}
    for (const l of ls) {
      if (!l.createdAt) continue
      const d = new Date(l.createdAt)
      if (isNaN(d)) continue
      const k = dayKey(d)
      newLeads[k] = (newLeads[k] || 0) + 1
    }
    for (const m of msgs) {
      if (!m || !m.at) continue
      const d = new Date(m.at)
      if (isNaN(d)) continue
      const k = dayKey(d)
      if (m.direction === 'out') sent[k] = (sent[k] || 0) + 1
      else if (m.direction === 'in') replies[k] = (replies[k] || 0) + 1
    }
    return { newLeads, sent, replies }
  }, [ls, msgs])

  // Per-day rows (most recent first) with all three series.
  const rows = useMemo(() =>
    dayList.map((d) => {
      const k = dayKey(d)
      return {
        key: k,
        date: d,
        today: isToday(d),
        newLeads: buckets.newLeads[k] || 0,
        sent: buckets.sent[k] || 0,
        replies: buckets.replies[k] || 0,
      }
    }), [dayList, buckets])

  // Range totals + today figures for the KPI row.
  const kpis = useMemo(() => {
    let newTotal = 0, sentTotal = 0, replyTotal = 0
    let newToday = 0, sentToday = 0
    for (const r of rows) {
      newTotal += r.newLeads
      sentTotal += r.sent
      replyTotal += r.replies
      if (r.today) { newToday = r.newLeads; sentToday = r.sent }
    }
    const avgPerDay = days > 0 ? Math.round(newTotal / days) : 0
    return { newTotal, sentTotal, replyTotal, newToday, sentToday, avgPerDay }
  }, [rows, days])

  const maxNew = Math.max(0, ...rows.map((r) => r.newLeads))
  const maxSent = Math.max(0, ...rows.map((r) => r.sent))

  // Trend panels read oldest -> newest (chronological left to right, top to bottom).
  const chrono = useMemo(() => [...rows].reverse(), [rows])

  return (
    <>
      <div className="page-head">
        <div>
          <span className="ttl">Daily analytics</span>
          <p className="sub">Day-by-day detail on new {terms.records} and outreach.</p>
        </div>
        <div className="actions">
          <div className="seg" role="tablist" aria-label="Date range">
            {RANGES.map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={days === n}
                onClick={() => setDays(n)}
              >
                {n} days
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="n">{kpis.newTotal}</div>
          <div className="l">New {terms.records}</div>
          <div className="d">today: {kpis.newToday}</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.sentTotal}</div>
          <div className="l">Messages sent</div>
          <div className="d">today: {kpis.sentToday}</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.replyTotal}</div>
          <div className="l">Replies</div>
          <div className="d">last {days} days</div>
        </div>
        <div className="kpi">
          <div className="n">{kpis.avgPerDay}</div>
          <div className="l">Avg {terms.records}/day</div>
          <div className="d">across {days} days</div>
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
        <section className="panel">
          <div className="panel-h">New {terms.records} per day</div>
          {chrono.map((r) => {
            const w = maxNew > 0 ? (r.newLeads / maxNew) * 100 : 0
            return (
              <div className="meter-row" key={r.key}>
                <span
                  className="ml"
                  style={r.today ? { fontWeight: 700, color: 'var(--brand-fg)' } : undefined}
                >
                  {shortDate(r.date)}{r.today ? ' •' : ''}
                </span>
                <div className="meter"><i style={{ width: w + '%' }} /></div>
                <span className="mv">{r.newLeads}</span>
              </div>
            )
          })}
        </section>

        <section className="panel">
          <div className="panel-h">Messages per day</div>
          {chrono.map((r) => {
            const w = maxSent > 0 ? (r.sent / maxSent) * 100 : 0
            return (
              <div className="meter-row" key={r.key}>
                <span
                  className="ml"
                  style={r.today ? { fontWeight: 700, color: 'var(--brand-fg)' } : undefined}
                >
                  {shortDate(r.date)}{r.today ? ' •' : ''}
                </span>
                <div className="meter"><i style={{ width: w + '%' }} /></div>
                <span className="mv">{r.sent}</span>
              </div>
            )
          })}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panel-h">By day</div>
        {rows.map((r, i) => (
          <div
            key={r.key}
            className="row-between"
            style={{
              flexWrap: 'wrap',
              gap: '6px 12px',
              padding: '10px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              {fmtDate(r.date.toISOString())}
              {r.today && <span className="badge">Today</span>}
            </span>
            <span className="faint" style={{ fontSize: 12.5 }}>
              New {r.newLeads} · Sent {r.sent} · Replies {r.replies}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="empty">
            <Chart style={{ width: 24, height: 24, opacity: 0.4 }} />
            <p>Nothing to show yet.</p>
          </div>
        )}
      </section>
    </>
  )
}
