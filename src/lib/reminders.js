// Follow-up reminders, computed from each lead's followupDate / followupTime.
// (The always-on WhatsApp/email reminders come later from a backend cron;
//  this is the in-app layer so the team can see what's due at a glance.)

const pad = (n) => String(n).padStart(2, '0')
const isoKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// leads we never need to chase
const CLOSED = new Set(['Closed Won', 'Closed Lost', 'Not Interested'])

const timeOf = (l) => (l.followupTime && /^\d{1,2}:\d{2}$/.test(l.followupTime) ? l.followupTime : '20:00')

// Date object for when a lead's follow-up is "due"
export const leadDueAt = (l) => {
  if (!l.followupDate) return null
  const key = String(l.followupDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  return new Date(`${key}T${timeOf(l)}:00`)
}

// Overdue / today / next-7-days, each sorted soonest-first
export function reminderGroups(leads) {
  const todayKey = isoKey(new Date())
  const horizon = new Date(); horizon.setHours(0, 0, 0, 0); horizon.setDate(horizon.getDate() + 7)
  const overdue = [], today = [], upcoming = []
  for (const l of leads || []) {
    if (!l.followupDate || CLOSED.has(l.journeyStatus)) continue
    const key = String(l.followupDate).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    const d = new Date(`${key}T00:00:00`)
    if (key < todayKey) overdue.push(l)
    else if (key === todayKey) today.push(l)
    else if (d <= horizon) upcoming.push(l)
  }
  const byWhen = (a, b) => (a.followupDate + timeOf(a)).localeCompare(b.followupDate + timeOf(b))
  return { overdue: overdue.sort(byWhen), today: today.sort((a, b) => timeOf(a).localeCompare(timeOf(b))), upcoming: upcoming.sort(byWhen) }
}

// what the bell badge shows = needs attention now
export function attentionCount(leads) {
  const g = reminderGroups(leads)
  return g.overdue.length + g.today.length
}

// today's follow-ups whose time has arrived (for desktop notifications)
export function dueNow(leads) {
  const now = new Date(), nowKey = isoKey(now)
  return (leads || []).filter((l) => {
    if (CLOSED.has(l.journeyStatus)) return false
    const d = leadDueAt(l)
    return d && isoKey(d) === nowKey && d <= now
  })
}
