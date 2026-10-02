import { useEffect, useId, useState } from 'react'
import { ACCENT_PRESETS, isAccentColor, normalizeAccent } from '../lib/palette.js'
import { useAccent } from '../lib/useAccent.js'

export default function AccentSettings() {
  const { color, persisted, setColor } = useAccent()
  const preset = ACCENT_PRESETS.find((item) => item.color === color)
  const [customOpen, setCustomOpen] = useState(!preset)
  const [draft, setDraft] = useState(color)
  const [error, setError] = useState('')
  const id = useId()
  useEffect(() => {
    setDraft(color)
    setError('')
    setCustomOpen(!ACCENT_PRESETS.some((item) => item.color === color))
  }, [color])

  const applyColor = (value) => {
    if (!isAccentColor(value)) { setError('Enter a valid hex color, like #7C3AED or #ABC.'); return }
    const nextColor = normalizeAccent(value)
    setDraft(nextColor)
    setError('')
    setColor(nextColor)
  }
  const pickPreset = (value) => {
    setCustomOpen(false)
    setDraft(value)
    setError('')
    setColor(value)
  }

  return <fieldset className="accent-picker" aria-describedby={`${id}-scope`}>
    <legend>Accent color</legend>
    <p className="theme-scope" id={`${id}-scope`}>Give the CRM your color. Change the header, buttons, and highlights in any display mode.</p>
    <div className="accent-options">
      {ACCENT_PRESETS.map((item) => <label className="accent-option" key={item.id}>
        <input type="radio" name={`${id}-accent`} checked={!customOpen && preset?.id === item.id}
          aria-label={item.label} onChange={() => pickPreset(item.color)} />
        <span className="accent-option-body"><span className="accent-swatch" style={{ '--swatch-color': item.color }} aria-hidden="true" /><strong>{item.label}</strong></span>
      </label>)}
      <label className="accent-option accent-option-custom">
        <input type="radio" name={`${id}-accent`} checked={customOpen || !preset} aria-label="Custom" onChange={() => setCustomOpen(true)} />
        <span className="accent-option-body"><span className="accent-swatch" style={{ '--swatch-color': color }} aria-hidden="true" /><strong>Custom</strong></span>
      </label>
    </div>
    {customOpen && <div className="accent-custom-controls">
      <label className="accent-color-picker"><input type="color" aria-label="Pick a custom color" value={color} onChange={(event) => applyColor(event.target.value)} /><span>Pick a color</span></label>
      <label className="accent-hex-label" htmlFor={`${id}-hex`}>Hex color<input className="input" id={`${id}-hex`} value={draft} placeholder="#7C3AED" spellCheck={false} autoComplete="off" maxLength={20}
        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setDraft(event.target.value); setError('') }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyColor(draft) } }} /></label>
      <button className="btn" type="button" onClick={() => applyColor(draft)}>Apply color</button>
    </div>}
    {error && <p className="accent-error" id={`${id}-error`} role="alert">{error}</p>}
    <p className="accent-note" role="status" aria-live="polite">{persisted
      ? `Current color: ${preset?.label || 'Custom'} (${color}). Saved in this browser.`
      : 'Applied for this visit. Your browser could not save the color.'}</p>
    <p className="accent-note">Text contrast adapts automatically. Success, warning, and error colors stay consistent.</p>
  </fieldset>
}
