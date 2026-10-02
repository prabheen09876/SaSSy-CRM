// Transparent local rules. This is a prioritization aid, not a prediction or
// an external AI service. Every point is explained in the saved summary.
export function scoreLead(lead, now = new Date()) {
  if (lead.journeyStatus === 'Closed Won') return { score: 100, summary: 'Successful outcome recorded. Complete the agreed handover and next steps.' }
  if (lead.journeyStatus === 'Closed Lost') return { score: 0, summary: 'Unsuccessful outcome recorded. Record the reason and review only if the person re-engages.' }
  let score = 30
  const factors = ['base 30']
  const add = (points, reason) => { score += points; factors.push(`${reason} ${points > 0 ? '+' : ''}${points}`) }
  if (lead.qualStatus === 'Qualified') add(25, 'qualified')
  if (lead.qualStatus === 'Unqualified') add(-25, 'unqualified')
  if (lead.email || lead.phone) add(10, 'contact available')
  if (String(lead.interest || '').trim()) add(10, 'need recorded')
  if (Number(lead.budget) > 0) add(10, 'value recorded')
  if (['Proposal Sent', 'Negotiation'].includes(lead.journeyStatus)) add(10, 'active opportunity')
  const closeDate = Date.parse(lead.expectedCloseDate || '')
  const daysToClose = (closeDate - new Date(now).getTime()) / 86400000
  if (Number.isFinite(daysToClose) && daysToClose >= -1 && daysToClose <= 30) add(10, 'closing within 30 days')
  if (lead.journeyStatus === 'Unresponsive') add(-15, 'unresponsive')
  if (lead.journeyStatus === 'Not Interested') add(-30, 'not interested')
  score = Math.max(0, Math.min(100, score))
  const action = lead.journeyStatus === 'Not Interested' ? 'Respect their preference; follow up only if invited.'
    : lead.qualStatus === 'Unqualified' ? 'Review fit before investing more time.'
      : score >= 75 ? 'Prioritize the next agreed action.'
        : score >= 50 ? 'Clarify requirements and agree on a next step.'
          : 'Clarify the need before prioritizing.'
  return { score, summary: `Rule-based score ${score}/100 (${factors.join('; ')}). ${action}` }
}

export const aiProvider = () => 'local-rules'
