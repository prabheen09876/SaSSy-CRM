import { useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { workspaceTerminology } from '../lib/workspace'
import { insertLead } from '../lib/db'
import { parseSpreadsheet, IMPORT_TARGETS, inferImportTarget, mapImportRow } from '../lib/xlsx'
import { X, Plus } from '../lib/icons.jsx'

export default function ImportModal({ onClose, onImported }) {
  const { notify, workspace, leadTypes } = useApp()
  const terms = workspaceTerminology(workspace)
  const customFields = workspace?.customFields || []
  const fileRef = useRef(null)
  const importing = useRef(false)
  const completedRows = useRef(new Set())
  const [step, setStep] = useState(1)            // 1 = upload, 2 = map
  const [parsed, setParsed] = useState(null)     // { headers, rows }
  const [mapping, setMapping] = useState({})     // header -> target field
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const fieldLabels = {
    budget: `${terms.opportunitySingular} value`,
    leadType: `${terms.recordSingular} category`,
    score: `${terms.recordSingular} score`,
  }
  const targets = [
    ...IMPORT_TARGETS.map((target) => ({ ...target, l: fieldLabels[target.v] || target.l })),
    ...customFields.map((field) => ({ v: `custom:${field.key}`, l: `Custom: ${field.label}` })),
  ]
  // Retain hidden custom fields when re-importing one of this CRM's exports.
  for (const target of Object.values(mapping)) {
    if (target.startsWith('custom:') && !targets.some(({ v }) => v === target)) targets.push({ v: target, l: `Saved field: ${target.slice(7)}` })
  }

  const handleFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const data = await parseSpreadsheet(file)
      if (!data.rows.length) { notify('That file has no rows', true); setBusy(false); return }
      const map = {}
      data.headers.forEach((h) => { map[h] = inferImportTarget(h, customFields) })
      completedRows.current = new Set()
      setProgress(0)
      setParsed(data)
      setMapping(map)
    } catch (err) {
      notify('Could not read file: ' + err.message, true)
    } finally {
      setBusy(false)
    }
  }

  const onPick = (e) => { handleFile(e.target.files?.[0]); e.target.value = '' }
  const onDrop = (e) => {
    e.preventDefault()
    if (!busy) handleFile(e.dataTransfer.files?.[0])
  }

  const runImport = async () => {
    if (!parsed || importing.current) return
    const selected = Object.values(mapping).filter(Boolean)
    if (!selected.includes('name')) return notify('Map a column to Name before importing.', true)
    if (new Set(selected).size !== selected.length) return notify('Map each CRM field only once, or skip the duplicate column.', true)
    importing.current = true
    setBusy(true)
    try {
      const rows = parsed.rows.map((row, index) => {
        try { return mapImportRow(row, mapping, { ...workspace, customFields, leadTypes, currency: workspace?.currency || 'USD' }) }
        catch (error) { throw new Error(`Row ${index + 2}: ${error.message}`) }
      })
      if (!rows.some(Boolean)) throw new Error('No rows contain a name. Check the column mapping.')
      for (let index = 0; index < rows.length; index++) {
        const fields = rows[index]
        if (!fields || completedRows.current.has(index)) continue
        await insertLead(fields)
        completedRows.current.add(index)
        setProgress(completedRows.current.size)
      }
      onImported(completedRows.current.size)   // parent reloads + shows the toast
      onClose()
    } catch (err) {
      notify(`${completedRows.current.size ? `${completedRows.current.size} saved. Continue to retry the remaining rows. ` : ''}Import stopped: ${err.message}`, true)
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    if (completedRows.current.size) onImported(completedRows.current.size)
    onClose()
  }

  const previewRows = parsed ? parsed.rows.slice(0, 3) : []

  return (
    <div className="overlay" onClick={(e) => { if (e.target.classList.contains('overlay')) close() }}>
      <div className="modal">
        <div className="mhead">
          <h2>{step === 1 ? `Import ${terms.records}` : 'Map columns'}</h2>
          <button type="button" className="icon-btn" onClick={close} disabled={busy} aria-label="Close import"><X /></button>
        </div>

        <div className="mbody">
          {step === 1 && (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => !busy && fileRef.current?.click()}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click() } }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, minHeight: 132, padding: 24, textAlign: 'center', cursor: busy ? 'default' : 'pointer',
                  border: '2px dashed var(--line-2)', borderRadius: 'var(--radius)',
                  background: 'var(--surface-2)', color: 'var(--ink-2)',
                }}
              >
                <Plus />
                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  {busy ? 'Reading file…' : 'Click to upload or drop a file'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>CSV, XLSX or XLS</div>
              </div>
              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
                onChange={onPick} style={{ display: 'none' }}
              />

              {parsed && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''}, {parsed.headers.length} column{parsed.headers.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ marginTop: 10, overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {parsed.headers.map((h) => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', color: 'var(--ink-2)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            {parsed.headers.map((h) => (
                              <td key={h} style={{ padding: '7px 10px', whiteSpace: 'nowrap', borderTop: i ? '1px solid var(--line)' : 'none', color: 'var(--ink)' }}>{String(r[h] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && parsed && (
            <>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 14 }}>
                Match each column to a CRM field. Name is required. Use YYYY-MM-DD for dates. Rows without a name are skipped. Importing never grants messaging consent.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {parsed.headers.map((h) => (
                  <div key={h} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>{h}</div>
                    <select
                      className="select"
                      value={mapping[h] || ''}
                      disabled={busy || progress > 0}
                      onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                      aria-label={`Map column ${h}`}
                    >
                      {targets.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {progress > 0 && <p role="status" style={{ marginTop: 14 }}>{progress} {progress === 1 ? terms.record : terms.records} saved. Continuing will skip rows already imported in this session.</p>}
            </>
          )}
        </div>

        <div className="mfoot">
          {step === 1 ? (
            <>
              <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" disabled={!parsed || busy} onClick={() => setStep(2)}>Continue</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy || progress > 0}>Back</button>
              <button type="button" className="btn primary" onClick={runImport} disabled={busy}>
                <Plus /> {busy ? `Importing… ${progress} saved` : progress ? 'Continue import' : `Import ${parsed.rows.length} row${parsed.rows.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
