import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { QUAL, PRIORITIES, qualPill, journeyPill, priorityPill, displayLeadTypeLabel, displayLeadTypePill } from '../lib/constants'
import { fmtDate, isToday, isOverdue, loadLatestActivityByLead, importedAssignee } from '../lib/db'
import { Trash, Users } from '../lib/icons.jsx'
import { workspaceStageOptions, workspaceTerminology } from '../lib/workspace'
import CallLeadButton from './CallLeadButton.jsx'

function PillSelect({ value, options, cls, onChange, label, disabled }) {
  const choices = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option)
  const displayValue = choices.find((option) => option.value === value)?.label || value || '—'
  return (
    <span className={'pill ' + cls + (disabled ? '' : ' pill-select')}>
      <span className="dot" />{displayValue}
      {!disabled && (
        <select value={value || ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
          {choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </span>
  )
}

function Fup({ d, t }) {
  if (!d) return <span className="faint">—</span>
  const cls = isToday(d) ? 'today' : isOverdue(d) ? 'overdue' : 'future'
  return <span className={'fup ' + cls}>{fmtDate(d)}{t ? <span className="faint" style={{ fontWeight: 400, marginLeft: 6 }}>{t}</span> : null}</span>
}

export const SORT_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'stage', label: 'Stage' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'added', label: 'Added' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'priority', label: 'Priority' },
]

function SortHeader({ column, sort, onSort }) {
  const active = sort.key === column.key
  const nextDirection = active && sort.direction === 'asc' ? 'descending' : 'ascending'
  return (
    <th className="sortable" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={'sort-header' + (active ? ' active' : '')}
        onClick={() => onSort(column.key)}
        aria-label={`${column.label}: sort ${nextDirection}`}
        title={`Sort ${column.label.toLowerCase()} ${nextDirection}`}
      >
        <span>{column.label}</span>
        <span className={'sort-indicator' + (active ? '' : ' inactive')} aria-hidden="true">
          {active ? (sort.direction === 'asc' ? 'ASC ↑' : 'DESC ↓') : '↕'}
        </span>
      </button>
    </th>
  )
}

export default function LeadsTable({ leads, onOpen, onHover, selectedLeadId, onSelect, sort, onSort }) {
  const { patchLead, removeLead, profiles, can, leadTypes, workspace } = useApp()
  const terms = workspaceTerminology(workspace)
  const canDelete = can('leads.delete')
  const canEdit = can('leads.edit')
  const staffName = (id) => profiles.find((p) => p.id === id)?.name || ''
  const [actMap, setActMap] = useState({})
  useEffect(() => {
    let alive = true
    loadLatestActivityByLead().then((m) => { if (alive) setActMap(m || {}) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // debounce hover so quick passes across rows don't fire fetches
  const hoverTimer = useRef(null)
  const enterHover = (l) => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => onHover && onHover(l), 130) }
  const leaveHover = () => { clearTimeout(hoverTimer.current); onHover && onHover(null) }
  const selectRow = (event, lead) => {
    if (!onSelect || event.target.closest('button, select, input, textarea, a, label')) return
    onSelect(lead.id)
  }
  const selectRowWithKeyboard = (event, lead) => {
    if (!onSelect || event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    onSelect(lead.id)
  }

  const onDelete = (l) => {
    if (!canDelete) return
    if (confirm(`Move ${l.name || `this ${terms.record}`} to the Bin? You can restore it later.`)) removeLead(l.id)
  }

  if (!leads.length) {
    return <div className="table-card"><div className="empty"><Users /><p>No {terms.records} match — adjust the filters, or add one.</p></div></div>
  }

  const Assignee = ({ l }) => {
    // imported leads keep the owner as text in remarks until a real profile is set
    const imported = !l.assignedTo ? importedAssignee(l.remarks) : ''
    return (
      <select className="mini-select" aria-label="Assign to" disabled={!canEdit}
        value={l.assignedTo || (imported ? '__imported__' : '')}
        onChange={(e) => { if (e.target.value !== '__imported__') patchLead(l.id, { assignedTo: e.target.value }) }}>
        <option value="">Unassigned</option>
        {imported && <option value="__imported__">{imported} (imported)</option>}
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name || p.role}</option>)}
      </select>
    )
  }
  const Priority = ({ l }) => (
    <select className="mini-select" aria-label="Priority" disabled={!canEdit}
      value={l.priority || ''} onChange={(e) => patchLead(l.id, { priority: e.target.value })}>
      <option value="">Priority</option>
      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  )
  const AddedDate = ({ l }) => (
    <span className="faint" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(l.createdAt)}</span>
  )
  const LastAct = ({ l }) => {
    const a = actMap[l.id]
    if (!a) return null
    const who = staffName(a.by)
    return (
      <div className="faint" style={{ fontSize: 11.5, marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', maxWidth: 300 }}>
        <span className={'tag ' + (a.type || 'Other')} style={{ marginBottom: 0, fontSize: 10, padding: '0 6px' }}>{a.type}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.notes}</span>
        <span style={{ flexShrink: 0 }}>· {fmtDate(a.at)}{who ? ' · ' + who : ''}</span>
      </div>
    )
  }

  return (
    <>
      {/* desktop */}
      <div className="table-card">
        <table>
          <thead>
            <tr>
              {SORT_COLUMNS.map((column) => <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}
              <th className="table-actions" aria-label="actions"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} data-lead-list-id={l.id}
                className={'lead-row-selectable' + (String(selectedLeadId) === String(l.id) ? ' lead-row-pinned' : '')}
                aria-selected={String(selectedLeadId) === String(l.id)} tabIndex="0"
                onMouseEnter={() => enterHover(l)} onMouseLeave={leaveHover}
                onClick={(event) => selectRow(event, l)} onKeyDown={(event) => selectRowWithKeyboard(event, l)}>
                <td className="name-cell">
                  <button className="lead-name" onClick={() => onOpen(l.id)}>{l.name || 'Unnamed'}</button>
                  {l.company && <div className="muted" style={{ fontSize: 12 }}>{l.company}</div>}
                  <div className="faint" style={{ fontSize: 11 }}>{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</div>
                  <LastAct l={l} />
                </td>
                <td><span className={'pill ' + displayLeadTypePill(l, leadTypes)}>{displayLeadTypeLabel(l, leadTypes)}</span></td>
                <td><PillSelect value={l.qualStatus} options={QUAL} cls={qualPill(l.qualStatus)} label="Qualification" disabled={!canEdit}
                  onChange={(v) => patchLead(l.id, { qualStatus: v })} /></td>
                <td><PillSelect value={l.journeyStatus} options={workspaceStageOptions(workspace, [l.journeyStatus])} cls={journeyPill(l.journeyStatus)} label="Stage" disabled={!canEdit}
                  onChange={(v) => patchLead(l.id, { journeyStatus: v })} /></td>
                <td><Fup d={l.followupDate} t={l.followupTime} /></td>
                <td><AddedDate l={l} /></td>
                <td><Assignee l={l} /></td>
                <td><Priority l={l} /></td>
                <td style={{ textAlign: 'right' }}>
                  {canDelete && <button className="btn danger sm" title="Delete" onClick={() => onDelete(l)}><Trash /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile */}
      <div className="mobile-sort" role="group" aria-label={`${terms.recordSingular} sorting`}>
        <label>
          <span>Sort by</span>
          <select className="select" value={sort.key} onChange={(e) => onSort(e.target.value)}>
            {SORT_COLUMNS.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onSort(sort.key)}
          aria-label={`Change to ${sort.direction === 'asc' ? 'descending' : 'ascending'} order`}
        >
          {sort.direction === 'asc' ? 'ASC' : 'DESC'}
        </button>
      </div>
      <div className="cards">
        {leads.map((l) => (
          <div className={'lead-card lead-row-selectable' + (String(selectedLeadId) === String(l.id) ? ' lead-row-pinned' : '')}
            key={l.id} data-lead-list-id={l.id} tabIndex="0"
            onMouseEnter={() => enterHover(l)} onMouseLeave={leaveHover}
            onClick={(event) => selectRow(event, l)} onKeyDown={(event) => selectRowWithKeyboard(event, l)}>
            <div className="top">
              <div>
                <button className="lead-name nm" onClick={() => onOpen(l.id)}>{l.name || 'Unnamed'}</button>
                {l.company && <div className="muted" style={{ fontSize: 12 }}>{l.company}</div>}
                <div className="meta">{[l.phone, l.email].filter(Boolean).join(' · ') || 'No contact info'}</div>
              </div>
              {canDelete && <button className="btn danger sm" onClick={() => onDelete(l)}><Trash /></button>}
            </div>
            <div className="lead-contact-actions"><CallLeadButton phone={l.phone} name={l.name} /></div>
            <LastAct l={l} />
            <div className="row">
              <span className={'pill ' + displayLeadTypePill(l, leadTypes)}>{displayLeadTypeLabel(l, leadTypes)}</span>
              <PillSelect value={l.qualStatus} options={QUAL} cls={qualPill(l.qualStatus)} label="Qualification" disabled={!canEdit}
                onChange={(v) => patchLead(l.id, { qualStatus: v })} />
              <PillSelect value={l.journeyStatus} options={workspaceStageOptions(workspace, [l.journeyStatus])} cls={journeyPill(l.journeyStatus)} label="Stage" disabled={!canEdit}
                onChange={(v) => patchLead(l.id, { journeyStatus: v })} />
              {l.priority && <span className={'pill ' + priorityPill(l.priority)}><span className="dot" />{l.priority}</span>}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Follow-up: <Fup d={l.followupDate} t={l.followupTime} /></span>
              <span className="faint" style={{ fontSize: 12 }}>
                {staffName(l.assignedTo) || (importedAssignee(l.remarks) ? `${importedAssignee(l.remarks)} (imported)` : 'Unassigned')}
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Added</span>
              <AddedDate l={l} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
