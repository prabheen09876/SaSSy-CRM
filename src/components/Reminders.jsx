import { useMemo, useState } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { reminderGroups, leadDueAt } from '../lib/reminders'
import { qualPill } from '../lib/constants'
import { fmtDate, initials } from '../lib/db'
import { Clock, Check, Bell } from '../lib/icons.jsx'
import { requestNotifyPermission, notifyPermission } from '../lib/notify'
import { subscribeToPush } from '../lib/push'

const timeLabel = (l) => {
  const d = leadDueAt(l)
  if (!d) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
// Snooze = tomorrow relative to the LATER of today or the current date, formatted in
// local time (no UTC round-trip) so an overdue reminder actually leaves the overdue bucket.
const nextDay = (date) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const cur = date ? new Date(String(date).slice(0, 10) + 'T00:00:00') : today
  const base = cur > today ? cur : today
  base.setDate(base.getDate() + 1)
  const y = base.getFullYear(), m = String(base.getMonth() + 1).padStart(2, '0'), d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 }
const SORTS = [
  { v: 'time', l: 'Soonest' },
  { v: 'priority', l: 'Priority' },
  { v: 'name', l: 'Name' },
  { v: 'manual', l: 'Manual' },
]
const sortItems = (items, sort) => {
  const arr = [...items]
  if (sort === 'name') arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  else if (sort === 'priority') arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
  else arr.sort((a, b) => {
    const da = leadDueAt(a), db = leadDueAt(b)
    return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity)
  })
  return arr
}

function Item({ l, onOpen, onDone, onSnooze, tone, assigneeOf, drag }) {
  const { workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const assignee = assigneeOf ? assigneeOf(l) : ''
  return (
    <div
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `3px solid var(--${tone})`,
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', flexWrap: 'wrap',
      }}>
      {drag && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span title="Drag to reorder" aria-hidden style={{ cursor: 'grab', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1 }}>⠿</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button className="icon-btn" onClick={drag.onUp} aria-label="Move up" title="Move up" style={{ height: 15, lineHeight: 1, fontSize: 9, color: 'var(--ink-2)' }}>▲</button>
            <button className="icon-btn" onClick={drag.onDown} aria-label="Move down" title="Move down" style={{ height: 15, lineHeight: 1, fontSize: 9, color: 'var(--ink-2)' }}>▼</button>
          </span>
        </span>
      )}
      <span style={{
        minWidth: 66, fontWeight: 700, fontSize: 13, color: `var(--${tone})`,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}><Clock /> {timeLabel(l)}</span>
      <button className="lead-name" onClick={() => onOpen(l.id)} style={{ flex: 1, minWidth: 140 }}>
        {l.name || `Unnamed ${terms.record}`}
        <span className="faint" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
          {fmtDate(l.followupDate)}{l.phone ? ` · ${l.phone}` : ''}
        </span>
      </button>
      {assignee && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }} title={`Assigned to ${assignee}`}>
          <span className="avatar sm" style={{ flexShrink: 0 }}>{initials(assignee)}</span>{assignee}
        </span>
      )}
      <span className={'pill ' + qualPill(l.qualStatus)}><span className="dot" />{l.qualStatus}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn ghost sm" onClick={() => onSnooze(l)} title="Move to tomorrow">Snooze</button>
        <button className="btn sm" onClick={() => onDone(l)} title="Clear this follow-up"><Check /> Done</button>
      </div>
    </div>
  )
}

function Section({ title, tone, items, ...rest }) {
  if (!items.length) return null
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
        color: 'var(--ink-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: `var(--${tone})` }} />
        {title}<span className="faint" style={{ fontWeight: 600 }}>· {items.length}</span>
      </h3>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {items.map((l) => <Item key={l.id} l={l} tone={tone} {...rest} />)}
      </div>
    </section>
  )
}

export default function Reminders({ leads, onOpen }) {
  const { patchLead, notify, profiles, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  // assigned owner: the real assigned_to, else the original owner still kept as text
  // in remarks on imported leads ("[Imported — was assigned to: X]")
  const assigneeOf = (l) => {
    const byId = (profiles || []).find((p) => p.id === l.assignedTo)?.name
    if (byId) return byId
    const m = /assigned to:\s*([^\]\n]+)/i.exec(l.remarks || '')
    return m ? m[1].trim() : ''
  }
  const [perm, setPerm] = useState(notifyPermission())
  const [sort, setSort] = useState('time')
  const groups = useMemo(() => reminderGroups(leads), [leads])
  const total = groups.overdue.length + groups.today.length + groups.upcoming.length
  const sorted = useMemo(() => ({
    overdue: sortItems(groups.overdue, sort),
    today: sortItems(groups.today, sort),
    upcoming: sortItems(groups.upcoming, sort),
  }), [groups, sort])

  // ── Manual (drag) ordering — a shared team priority, stored in leads.manual_rank ─
  const [dragIdx, setDragIdx] = useState(null)
  // bucket colour per lead id (from the date grouping) for the flat manual list
  const toneById = useMemo(() => {
    const m = {}
    groups.overdue.forEach((l) => { m[l.id] = 'danger' })
    groups.today.forEach((l) => { m[l.id] = 'info' })
    groups.upcoming.forEach((l) => { m[l.id] = 'success' })
    return m
  }, [groups])
  // unique, stable fallback so unranked leads keep their soonest order and never tie
  // (a tie would make dropping *between* two cards impossible)
  const idFrac = (id) => { let h = 0; const s = String(id); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000; return h / 100000 }
  const effRank = (l) => (l.manualRank == null ? ((leadDueAt(l)?.getTime() ?? 0) + idFrac(l.id)) : Number(l.manualRank))
  const manualItems = useMemo(
    () => [...groups.overdue, ...groups.today, ...groups.upcoming].sort((a, b) => effRank(a) - effRank(b)),
    [groups],
  )
  // move card from index `from` to `to`; give it a rank midway between its new neighbours
  const move = (from, to) => {
    if (from === to || to < 0 || to >= manualItems.length) return
    const arr = [...manualItems]
    const [m] = arr.splice(from, 1)
    arr.splice(to, 0, m)
    const prev = arr[to - 1], next = arr[to + 1]
    const newRank = (prev && next) ? (effRank(prev) + effRank(next)) / 2
      : prev ? effRank(prev) + 1
      : next ? effRank(next) - 1
      : 0
    patchLead(m.id, { manualRank: newRank })
  }

  const onDone = (l) => { patchLead(l.id, { followupDate: '', followupTime: '' }); notify(`Cleared follow-up for ${l.name || terms.record}`) }
  const onSnooze = (l) => { patchLead(l.id, { followupDate: nextDay(l.followupDate) }); notify('Moved to tomorrow') }

  const enableAlerts = async () => {
    const p = await requestNotifyPermission()
    setPerm(p)
    if (p !== 'granted') {
      notify(p === 'denied'
        ? 'Notifications are blocked — enable them in your device/browser settings'
        : 'Notifications aren’t available here', true)
      return
    }
    const pushed = await subscribeToPush().catch(() => false)
    notify(
      pushed
        ? 'Background alerts active — your phone will buzz for due follow-ups even when the app is closed'
        : 'Alerts work while the app is open, but background push couldn’t be set up here — reload once, or use the home-screen app',
      !pushed,
    )
  }

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 19 }}>Reminders</h2>
        {perm !== 'unsupported' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {perm === 'granted' && <span className="faint" style={{ fontSize: 12 }}>Alerts on</span>}
            <button className="btn sm" onClick={enableAlerts}>
              <Bell /> {perm === 'granted' ? 'Re-check alerts' : 'Enable alerts'}
            </button>
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="row-between" style={{ marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
          <span className="faint" style={{ fontSize: 12.5 }}>Sort by</span>
          <div className="seg" role="tablist" aria-label="Sort reminders">
            {SORTS.map((s) => (
              <button key={s.v} role="tab" aria-selected={sort === s.v} onClick={() => setSort(s.v)}>{s.l}</button>
            ))}
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="empty" style={{
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          padding: '52px 20px', textAlign: 'center',
        }}>
          <Bell style={{ width: 28, height: 28, opacity: .4 }} />
          <p style={{ marginTop: 8 }}>You're all caught up — no follow-ups due.</p>
        </div>
      ) : sort === 'manual' ? (
        <>
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
            Drag cards — or use ▲▼ — to set the team's call priority (top = call first). This order is shared with everyone.
          </p>
          <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
            {manualItems.map((l, i) => (
              <Item key={l.id} l={l} tone={toneById[l.id] || 'success'} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} assigneeOf={assigneeOf}
                drag={{
                  onDragStart: () => setDragIdx(i),
                  onDragOver: (e) => e.preventDefault(),
                  onDrop: () => { if (dragIdx != null) move(dragIdx, i); setDragIdx(null) },
                  onDragEnd: () => setDragIdx(null),
                  onUp: () => move(i, i - 1),
                  onDown: () => move(i, i + 1),
                }} />
            ))}
          </div>
        </>
      ) : (
        <>
          <Section title="Overdue" tone="danger" items={sorted.overdue} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} assigneeOf={assigneeOf} />
          <Section title="Today" tone="info" items={sorted.today} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} assigneeOf={assigneeOf} />
          <Section title="Next 7 days" tone="success" items={sorted.upcoming} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} assigneeOf={assigneeOf} />
        </>
      )}

      <p className="faint" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        Install {workspace?.name || 'Workspace CRM'} to your phone's home screen (Add to Home Screen), then tap “Enable alerts”.
        You'll get a buzz for follow-ups due that day even when the app is closed or the screen is off —
        a daily 9 AM check plus alerts while the app is open. On iPhone the app must be installed to the
        home screen first (iOS 16.4+).
      </p>
    </div>
  )
}
