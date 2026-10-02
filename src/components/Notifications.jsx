import { useMemo } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { markNotificationRead, markAllNotificationsRead } from '../lib/db'
import { Bell, Check } from '../lib/icons.jsx'

// kind → label, accent tone, glyph
const KIND = {
  call_request: { tone: 'accent',  icon: '📞' },
  lead:         { tone: 'brand-fg', icon: '✨' },
  reply:        { tone: 'success', icon: '💬' },
  booking:      { tone: 'info',    icon: '📅' },
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const dayBucket = (iso) => {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return 'Earlier'
}
const relTime = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export default function Notifications({ notifs, me, onOpen, reload }) {
  const { workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const isUnread = (n) => !(n.read_by || []).includes(me?.id)
  const unread = notifs.filter(isUnread).length

  const groups = useMemo(() => {
    const g = { Today: [], Yesterday: [], Earlier: [] }
    for (const n of notifs) g[dayBucket(n.created_at)].push(n)
    return g
  }, [notifs])

  const open = async (n) => {
    if (isUnread(n)) { try { await markNotificationRead(n.id) } catch {} reload() }
    if (n.lead_id) onOpen(n.lead_id)
  }
  const markAll = async () => { try { await markAllNotificationsRead() } catch {} reload() }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="row-between" style={{ marginBottom: 18, gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell /> Notifications {unread > 0 && <span className="pill neutral">{unread} new</span>}
        </h2>
        {unread > 0 && <button className="btn ghost sm" onClick={markAll}><Check /> Mark all read</button>}
      </div>

      {notifs.length === 0 ? (
        <div className="empty" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '52px 20px', textAlign: 'center' }}>
          <Bell style={{ width: 28, height: 28, opacity: .4 }} />
          <p style={{ marginTop: 8 }}>No notifications yet.</p>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
            New call requests, {terms.records}, bookings and WhatsApp replies will show up here.
          </p>
        </div>
      ) : ['Today', 'Yesterday', 'Earlier'].map((label) => groups[label].length > 0 && (
        <section key={label} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>{label}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {groups[label].map((n) => {
              const k = KIND[n.kind] || KIND.lead
              const unreadN = isUnread(n)
              return (
                <button key={n.id} onClick={() => open(n)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left', width: '100%',
                  padding: '12px 14px', cursor: 'pointer', font: 'inherit', color: 'var(--ink)',
                  background: unreadN ? 'var(--brand-soft)' : 'var(--surface)',
                  border: '1px solid var(--line)', borderLeft: `3px solid var(--${k.tone})`,
                  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
                }}>
                  <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }} aria-hidden>{k.icon}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <strong style={{ fontSize: 14, fontWeight: unreadN ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</strong>
                      {unreadN && <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--brand-fg)', flexShrink: 0 }} />}
                    </span>
                    {n.body && (
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</span>
                    )}
                  </span>
                  <span className="faint" style={{ fontSize: 11.5, flexShrink: 0, whiteSpace: 'nowrap' }}>{relTime(n.created_at)}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
