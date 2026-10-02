import { useState } from 'react'
import { useApp } from '../App.jsx'
import { journeyPill } from '../lib/constants'
import { workspaceTerminology, workspaceStageOptions, workspaceStageLabel } from '../lib/workspace'
import { totalsByCurrency, formatMoney, recordCurrency } from '../lib/money'

export default function Funnel({ leads, onOpen }) {
  const { profiles, profilesById, workspace, patchLead, can } = useApp()
  const terms = workspaceTerminology(workspace)
  const [owner, setOwner] = useState('all')
  const [busy, setBusy] = useState(null)
  const visible = leads.filter((lead) => owner === 'all' || (owner === 'unassigned' ? !lead.assignedTo : lead.assignedTo === owner))
  const stages = workspaceStageOptions(workspace, visible.map((lead) => lead.journeyStatus))
  const total = (items) => {
    const totals = totalsByCurrency(items, workspace.currency)
    return totals.length ? totals.map(([currency, amount]) => <span className="pipeline-money" key={currency}>{formatMoney(amount, currency)}</span>) : <span className="pipeline-money">{formatMoney(0, workspace.currency)}</span>
  }
  const open = visible.filter((lead) => !['Closed Won', 'Closed Lost', 'Not Interested'].includes(lead.journeyStatus))
  const move = async (lead, stage) => {
    setBusy(lead.id)
    try { await patchLead(lead.id, { journeyStatus: stage }) } finally { setBusy(null) }
  }
  return <section>
    <div className="page-head">
      <div><h1 className="ttl">Pipeline</h1><p className="sub">Track {terms.opportunities} from first contact to outcome.</p></div>
      <select className="select" aria-label="Filter pipeline by owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="all">Everyone</option><option value="unassigned">Unassigned</option>
        {profiles.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
    <div className="pipeline-summary">
      <div><strong>{open.length}</strong><span>Open {terms.opportunities}</span></div>
      <div><strong>{total(open)}</strong><span>Potential value</span></div>
      <div><strong>{total(visible.filter((lead) => lead.journeyStatus === 'Closed Won'))}</strong><span>{workspaceStageLabel(workspace, 'Closed Won')} value</span></div>
      <p>Estimated values are grouped by currency. No currency conversion is applied.</p>
    </div>
    <div className="pipeline-board" role="region" aria-label="Pipeline stages" tabIndex="0">
      {stages.map((stage) => {
        const items = visible.filter((lead) => (lead.journeyStatus || 'New Lead') === stage.value)
        return <section className="pipeline-column" key={stage.value} aria-label={stage.label}>
          <header><span className={'pill ' + journeyPill(stage.value)}>{stage.label}</span><span>{items.length}</span><small>{total(items)}</small></header>
          {items.length === 0 && <p className="pipeline-empty">No {terms.opportunities} at this stage.</p>}
          {items.map((lead) => <article className="pipeline-opportunity" key={lead.id}>
            <button className="pipeline-open" onClick={() => onOpen(lead.id)}>{lead.name || 'Unnamed contact'}</button>
            <p>{lead.company || lead.interest || 'Add business details'}</p>
            {lead.budget !== '' && lead.budget != null && <strong>{formatMoney(Number(lead.budget) || 0, recordCurrency(lead, workspace.currency))}</strong>}
            <div className="pipeline-owner">{profilesById[lead.assignedTo]?.name || 'Unassigned'}{lead.followupDate && <span>Follow up {lead.followupDate}</span>}</div>
            {can('leads.edit') && <select aria-label={`Stage for ${lead.name}`} value={lead.journeyStatus || 'New Lead'} disabled={busy === lead.id} onChange={(e) => move(lead, e.target.value)}>
              {stages.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>}
          </article>)}
        </section>
      })}
    </div>
  </section>
}
