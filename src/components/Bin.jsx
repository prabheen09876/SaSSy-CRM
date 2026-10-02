import { useEffect, useState } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { loadTrash, restoreLead, purgeLead, emptyTrash, fmtDate, initials } from '../lib/db'
import { qualPill } from '../lib/constants'
import { Trash, Check } from '../lib/icons.jsx'

export default function Bin() {
  const { notify, reload, me, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    loadTrash()
      .then((rows) => { if (alive) setItems(rows || []) })
      .catch(() => { if (alive) notify('Could not load the Bin', true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const isAdmin = me.role === 'admin'

  const onEmpty = async () => {
    if (!window.confirm(`Permanently delete every ${terms.record} in the Bin? This cannot be undone.`)) return
    try {
      await emptyTrash()
      setItems([])
      notify('Bin emptied')
    } catch {
      notify('Could not empty the Bin', true)
    }
  }

  const onRestore = async (l) => {
    try {
      await restoreLead(l.id)
      setItems((xs) => xs.filter((x) => x.id !== l.id))
      await reload()
      notify('Restored ' + (l.name || terms.record))
    } catch {
      notify(`Could not restore this ${terms.record}`, true)
    }
  }

  const onPurge = async (l) => {
    if (!window.confirm('Permanently delete ' + (l.name || `this ${terms.record}`) + '? This cannot be undone.')) return
    try {
      await purgeLead(l.id)
      setItems((xs) => xs.filter((x) => x.id !== l.id))
      notify('Deleted permanently')
    } catch {
      notify(`Could not delete this ${terms.record}`, true)
    }
  }

  if (loading) {
    return (
      <div className="center" style={{ minHeight: '40vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="ttl">Bin</span>
          <p className="sub">Deleted {terms.records} are kept here so nothing is lost — restore one anytime, or clear the Bin for good.</p>
        </div>
        {isAdmin && items.length > 0 && (
          <div className="actions">
            <button className="btn danger sm" onClick={onEmpty}>
              <Trash /> Empty Bin
            </button>
          </div>
        )}
      </div>

      {!items.length ? (
        <div className="empty">
          <Trash width={28} height={28} />
          <p>The Bin is empty.</p>
        </div>
      ) : (
        <div className="stack" style={{ display: 'grid', gap: 12 }}>
          {items.map((l) => (
            <div key={l.id} className="panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="avatar sm">{initials(l.name)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block' }}>{l.name || `Unnamed ${terms.record}`}</strong>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {[l.phone, l.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </span>
                </div>
                <span className={'pill ' + qualPill(l.qualStatus)}><span className="dot" />{l.qualStatus}</span>
                <span className="faint" style={{ fontSize: 12 }}>Deleted {fmtDate(l.deletedAt)}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  <button className="btn sm" onClick={() => onRestore(l)}>
                    <Check /> Restore
                  </button>
                  {isAdmin && (
                    <button className="btn danger sm" onClick={() => onPurge(l)}>
                      <Trash /> Delete forever
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
