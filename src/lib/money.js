export const recordCurrency = (record, fallback = 'USD') => {
  const value = String(record?.currency || fallback).trim().toUpperCase()
  return /^[A-Z]{3}$/.test(value) ? value : fallback
}

// A workspace may hold values in several currencies. Group them; adding unlike
// currencies or silently relabelling them would misstate the pipeline.
export function totalsByCurrency(records, fallback = 'USD') {
  const totals = new Map()
  for (const record of records) {
    if (record.budget === '' || record.budget == null) continue
    const value = Number(record.budget)
    if (!Number.isFinite(value) || value < 0) continue
    const currency = recordCurrency(record, fallback)
    totals.set(currency, (totals.get(currency) || 0) + value)
  }
  return [...totals].sort(([a], [b]) => a === fallback ? -1 : b === fallback ? 1 : a.localeCompare(b))
}

export const formatMoney = (amount, currency = 'USD') => new Intl.NumberFormat(undefined, {
  style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0,
}).format(amount)
