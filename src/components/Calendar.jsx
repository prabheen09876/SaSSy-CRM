import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { qualPill, priorityPill, apptTypeLabel, apptStatusLabel } from '../lib/constants'
import { loadUpcomingAppointments, subscribeAppointments, initials } from '../lib/db'
import { Back } from '../lib/icons.jsx'

// ── date helpers (all built from new Date(); ISO 'YYYY-MM-DD' keys) ──────────
const pad = (n) => String(n).padStart(2, '0')
const isoKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// subtle chip colour by qualStatus — green / red / amber
const chipTone = (s) => {
  const p = qualPill(s)                       // 'success' | 'danger' | 'warning' | ...
  const tone = p === 'success' ? 'success' : p === 'danger' ? 'danger' : 'warning'
  return { fg: `var(--${tone})`, bg: `var(--${tone}-soft)` }
}
const leadTone = (s) => { const p = qualPill(s); return p === 'success' ? 'success' : p === 'danger' ? 'danger' : 'warning' }

// small colour dot marking a lead's priority (High/Medium/Low), same palette as the app's pills
const priorityDot = (p, size = 8) => p ? (
  <span title={`${p} priority`} aria-label={`${p} priority`} style={{
    display: 'inline-block', width: size, height: size, borderRadius: '50%',
    background: `var(--${priorityPill(p)})`, flexShrink: 0,
  }} />
) : null

// one readable row in the mobile agenda list
function AgendaRow({ time, tone, name, sub, priority, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
      padding: '10px 12px', cursor: 'pointer', font: 'inherit', color: 'var(--ink)',
      background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `3px solid var(--${tone})`,
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
    }}>
      <span style={{ flexShrink: 0, minWidth: 60, fontWeight: 700, fontSize: 12.5, color: `var(--${tone})` }}>{time}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {priorityDot(priority)}
          <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </span>
    </button>
  )
}

// 'HH:MM' -> '8:00 PM' style label; default 8PM when no time set
const timeLabel = (t) => {
  const [h, m] = (t && /^\d{1,2}:\d{2}$/.test(t) ? t : '20:00').split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${ap}`
}
const sortTime = (t) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t : '20:00')

export default function Calendar({ leads, onOpen, day, setDay, onRefresh }) {
  const { profiles, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const staffName = (id) => (profiles || []).find((p) => p.id === id)?.name || ''
  // Assigned owner: the real assigned_to, else the original owner still kept as
  // text in remarks on imported leads ("[Imported — was assigned to: X]").
  const assignedLabel = (l) => {
    if (!l) return ''
    const byId = staffName(l.assignedTo)
    if (byId) return byId
    const m = /assigned to:\s*([^\]\n]+)/i.exec(l.remarks || '')
    return m ? m[1].trim() : ''
  }
  const AssigneeChip = ({ name }) => name ? (
    <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
      <span className="avatar sm" style={{ flexShrink: 0 }}>{initials(name)}</span>{name}
    </span>
  ) : null

  const today = new Date()
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [appts, setAppts] = useState([])
  // `day` (open-day ISO key) is lifted to App so returning from a lead reopens it
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const mobile = width < 720   // 7-column grid is unreadable below this — use an agenda list

  // Keep the calendar live so a follow-up or booking shows without a manual refresh:
  //  • load appointments on mount, then reload on any realtime change to the
  //    appointments table and whenever the tab regains focus;
  //  • on those same focus/realtime signals also ask the app to re-pull leads, so a
  //    follow-up date/time edit (which lives on the lead) reflects here too — even
  //    when this calendar was already open in another tab or on a teammate's screen.
  // We deliberately DON'T re-pull leads on the initial mount: the leads prop is already
  // current, and a follow-up you just set is held optimistically while its save is in
  // flight — re-reading the DB too early could momentarily wipe it. Focus/realtime
  // signals only ever fire after a change has committed (or in another tab), so they're
  // safe. Your own follow-ups still appear instantly via the optimistic patchLead.
  useEffect(() => {
    let alive = true, t
    const reloadAppts = () => loadUpcomingAppointments().then((a) => { if (alive) setAppts(a) }).catch(() => {})
    reloadAppts()   // initial load — appointments only
    const bump = () => { clearTimeout(t); t = setTimeout(() => { reloadAppts(); onRefresh?.() }, 300) }
    const unsub = subscribeAppointments(bump)
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      alive = false; clearTimeout(t); unsub()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [onRefresh])
  const leadsById = useMemo(() => Object.fromEntries((leads || []).map((l) => [l.id, l])), [leads])
  const apptName = (a) => leadsById[a.leadId]?.name || 'Meeting'
  const apptTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // group appointments by local ISO day
  const apptsByDay = useMemo(() => {
    const m = {}
    for (const a of appts || []) {
      if (!a.datetime) continue
      const key = isoKey(new Date(a.datetime))
      ;(m[key] || (m[key] = [])).push(a)
    }
    for (const k in m) m[k].sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
    return m
  }, [appts])

  // group leads by followupDate ISO key
  const byDay = useMemo(() => {
    const m = {}
    for (const l of leads || []) {
      if (!l.followupDate) continue
      const key = String(l.followupDate).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
      ;(m[key] || (m[key] = [])).push(l)
    }
    for (const k in m) m[k].sort((a, b) => sortTime(a.followupTime).localeCompare(sortTime(b.followupTime)))
    return m
  }, [leads])

  const todayKey = isoKey(today)
  const year = cursor.getFullYear(), month = cursor.getMonth()

  // mobile agenda: the days of the cursor month that actually have something on them
  const monthAgenda = useMemo(() => {
    const out = []
    const dim = new Date(year, month + 1, 0).getDate()
    for (let dd = 1; dd <= dim; dd++) {
      const key = isoKey(new Date(year, month, dd))
      const dayAppts = apptsByDay[key] || []
      const dayLeads = byDay[key] || []
      if (dayAppts.length || dayLeads.length) out.push({ key, dd, dayAppts, dayLeads })
    }
    return out
  }, [year, month, apptsByDay, byDay])

  // build the 6-row grid: leading days from prev month + this month + trailing
  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const start = new Date(year, month, 1 - first.getDay())   // back up to Sunday
    const out = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      out.push(d)
    }
    return out
  }, [year, month])

  const go = (delta) => setCursor(new Date(year, month + delta, 1))
  const goToday = () => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setDay(null) }
  // year range for the picker — always spans a few years around today AND the cursor
  const yearFrom = Math.min(today.getFullYear() - 3, year)
  const yearTo = Math.max(today.getFullYear() + 5, year)
  const years = []
  for (let y = yearFrom; y <= yearTo; y++) years.push(y)

  // ── DAY VIEW ───────────────────────────────────────────────────────────────
  if (day) {
    const list = byDay[day] || []
    const dayAppts = apptsByDay[day] || []
    const d = new Date(day + 'T00:00:00')
    const heading = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    const shiftDay = (delta) => { const nd = new Date(day + 'T00:00:00'); nd.setDate(nd.getDate() + delta); setDay(isoKey(nd)) }
    const rowStyle = {
      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
      width: '100%', minHeight: 56, padding: '12px 16px', cursor: 'pointer',
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', font: 'inherit', color: 'var(--ink)', boxShadow: 'var(--shadow)',
    }
    const subhead = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '2px 0 8px' }
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => setDay(null)}><Back /> Back to month</button>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>{heading}</h2>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn ghost sm" onClick={() => shiftDay(-1)} aria-label="Previous day">‹ Prev</button>
            <button className="btn sm" onClick={() => setDay(isoKey(new Date()))}>Today</button>
            <button className="btn ghost sm" onClick={() => shiftDay(1)} aria-label="Next day">Next ›</button>
          </div>
        </div>

        {dayAppts.length > 0 && (
          <div style={{ marginBottom: list.length ? 22 : 0 }}>
            <div style={subhead}>Meetings</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {dayAppts.map((a) => (
                <button key={a.id} onClick={() => onOpen(a.leadId)} style={{ ...rowStyle, borderLeft: '3px solid var(--brand-fg)' }}>
                  <span style={{
                    flexShrink: 0, minWidth: 78, fontWeight: 700, fontSize: 13, color: 'var(--brand-fg)',
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--brand-soft)', textAlign: 'center',
                  }}>{apptTime(a.datetime)}</span>
                  <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{apptName(a)}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{apptTypeLabel(a.type)} · {apptStatusLabel(a.status)}</span>
                  </span>
                  <AssigneeChip name={assignedLabel(leadsById[a.leadId])} />
                </button>
              ))}
            </div>
          </div>
        )}

        {list.length > 0 && dayAppts.length > 0 && <div style={subhead}>Follow-ups</div>}

        {(list.length === 0 && dayAppts.length === 0) ? (
          <div className="empty" style={{
            padding: '40px 20px', textAlign: 'center', color: 'var(--ink-2)',
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          }}>
            Nothing scheduled.
          </div>
        ) : list.length > 0 ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {list.map((l) => {
              const tone = chipTone(l.qualStatus)
              return (
                <button key={l.id} onClick={() => onOpen(l.id)} style={rowStyle}>
                  <span style={{
                    flexShrink: 0, minWidth: 78, fontWeight: 600, fontSize: 13,
                    color: tone.fg, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    background: tone.bg, textAlign: 'center',
                  }}>
                    {timeLabel(l.followupTime)}
                  </span>
                  <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      {priorityDot(l.priority)}
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.name || `Unnamed ${terms.record}`}
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                      {l.qualStatus}{l.phone ? ` · ${l.phone}` : ''}{l.priority ? ` · ${l.priority} priority` : ''}
                    </span>
                  </span>
                  <AssigneeChip name={assignedLabel(l)} />
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  // ── MONTH VIEW ───────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
          <select className="select" value={month} aria-label="Month"
            onChange={(e) => setCursor(new Date(year, Number(e.target.value), 1))}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select className="select" value={year} aria-label="Year"
            onChange={(e) => setCursor(new Date(Number(e.target.value), month, 1))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn ghost sm" onClick={() => go(-1)} aria-label="Previous month">‹ Prev</button>
        <button className="btn sm" onClick={goToday}>Today</button>
        <button className="btn ghost sm" onClick={() => go(1)} aria-label="Next month">Next ›</button>
      </div>

      {mobile && (
        <div style={{ display: 'grid', gap: 14 }}>
          {monthAgenda.length === 0 ? (
            <div className="empty" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '40px 20px', textAlign: 'center', color: 'var(--ink-2)' }}>
              Nothing scheduled in {MONTHS[month]}.
            </div>
          ) : monthAgenda.map(({ key, dd, dayAppts, dayLeads }) => {
            const dObj = new Date(year, month, dd)
            const isTodayRow = key === todayKey
            return (
              <div key={key}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: isTodayRow ? 'var(--brand-fg)' : 'var(--ink-3)', margin: '2px 2px 8px' }}>
                  {WEEKDAYS[dObj.getDay()]}, {dd} {MONTHS[month]}{isTodayRow ? ' · Today' : ''}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {dayAppts.map((a) => (
                    <AgendaRow key={'a' + a.id} time={apptTime(a.datetime)} tone="brand-fg"
                      name={apptName(a)} sub={`${apptTypeLabel(a.type)} · ${apptStatusLabel(a.status)}`}
                      onClick={() => onOpen(a.leadId)} />
                  ))}
                  {dayLeads.map((l) => (
                    <AgendaRow key={'l' + l.id} time={timeLabel(l.followupTime)} tone={leadTone(l.qualStatus)}
                      name={l.name || `Unnamed ${terms.record}`} sub={`${l.qualStatus}${l.phone ? ' · ' + l.phone : ''}`}
                      priority={l.priority} onClick={() => onOpen(l.id)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!mobile && (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow)',
      }}>
        {/* weekday header row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
          {WEEKDAYS.map((w) => (
            <div key={w} style={{
              padding: '8px 6px', textAlign: 'center', fontSize: 11.5, fontWeight: 700,
              letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)',
              background: 'var(--surface-2)',
            }}>
              {w}
            </div>
          ))}
        </div>

        {/* day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((d, i) => {
            const key = isoKey(d)
            const inMonth = d.getMonth() === month
            const isTodayCell = key === todayKey
            const dayLeads = byDay[key] || []
            const dayAppts = apptsByDay[key] || []
            const items = [
              ...dayAppts.map((a) => ({ kind: 'appt', id: 'a' + a.id, a })),
              ...dayLeads.map((l) => ({ kind: 'lead', id: 'l' + l.id, l })),
            ]
            const shown = items.slice(0, 3)
            const extra = items.length - shown.length
            return (
              <div key={key}
                onClick={() => setDay(key)}
                role="button" tabIndex={0}
                aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}, ${items.length} scheduled`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDay(key) } }}
                style={{
                  minHeight: 84, padding: 6, cursor: 'pointer',
                  borderRight: (i % 7 !== 6) ? '1px solid var(--line)' : 'none',
                  borderTop: i >= 7 ? '1px solid var(--line)' : 'none',
                  background: isTodayCell ? 'var(--brand-soft)' : inMonth ? 'var(--surface)' : 'var(--surface-2)',
                  display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
                }}>
                <div style={{
                  fontSize: 12.5, fontWeight: isTodayCell ? 700 : 600, lineHeight: 1,
                  color: isTodayCell ? 'var(--brand-fg)' : inMonth ? 'var(--ink)' : 'var(--ink-3)',
                  marginBottom: 2,
                }}>
                  {d.getDate()}
                </div>

                {shown.map((it) => {
                  if (it.kind === 'appt') {
                    const a = it.a
                    return (
                      <button key={it.id}
                        onClick={(e) => { e.stopPropagation(); onOpen(a.leadId) }}
                        title={`${apptTime(a.datetime)} · ${apptName(a)} · ${apptTypeLabel(a.type)} (${apptStatusLabel(a.status)})`}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                          font: 'inherit', fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                          color: 'var(--brand-fg)', background: 'var(--brand-soft)',
                          border: '1px solid transparent', borderLeft: '2px solid var(--brand-fg)', borderRadius: 6,
                          padding: '3px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        {apptTime(a.datetime)} · {apptName(a)}
                      </button>
                    )
                  }
                  const l = it.l
                  const tone = chipTone(l.qualStatus)
                  return (
                    <button key={it.id}
                      onClick={(e) => { e.stopPropagation(); onOpen(l.id) }}
                      title={`${timeLabel(l.followupTime)} · ${l.name || `Unnamed ${terms.record}`}${l.priority ? ` · ${l.priority} priority` : ''}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', cursor: 'pointer',
                        font: 'inherit', fontSize: 11, fontWeight: 600, lineHeight: 1.25,
                        color: tone.fg, background: tone.bg,
                        border: '1px solid transparent', borderRadius: 6,
                        padding: '3px 5px', overflow: 'hidden',
                      }}>
                      {priorityDot(l.priority, 6)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {timeLabel(l.followupTime)} · {l.name || `Unnamed ${terms.record}`}
                      </span>
                    </button>
                  )
                })}

                {extra > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', paddingLeft: 2 }}>
                    +{extra} more
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      )}
    </div>
  )
}
