import { useId } from 'react'
import { Sun, Moon } from '../lib/icons.jsx'
import { useTheme } from '../lib/useTheme.js'
import AccentSettings from './AccentSettings.jsx'
import './appearance.css'

function DeviceIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
}

const choices = [
  { value: 'light', label: 'Light', description: 'A bright, clear workspace.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Softer light, deeper surfaces.', icon: Moon },
  { value: 'system', label: 'Follow device', description: 'Match your device’s appearance.', icon: DeviceIcon },
]

function Preview({ theme }) {
  return <span className={`theme-mini theme-mini-${theme}`}>
    <span className="theme-mini-header"><i /><i /></span>
    <span className="theme-mini-main"><span className="theme-mini-rail"><i /><i /><i /></span>
      <span className="theme-mini-content"><span className="theme-mini-heading" /><span className="theme-mini-table"><i /><i /><i /></span></span>
    </span>
  </span>
}

export default function AppearanceSettings() {
  const { preference, resolvedTheme, persisted, setPreference } = useTheme()
  const id = useId()
  return <>
    <div className="settings-section-heading"><h2>Appearance</h2><p>Your colors. Your preferred way to work.</p></div>
    <div className="panel appearance-panel">
      <fieldset className="theme-picker" aria-describedby={`${id}-scope`}>
        <legend>Display mode</legend>
        <p id={`${id}-scope`} className="theme-scope">Choose how the CRM looks in this browser. Your team’s preferences stay their own.</p>
        <div className="theme-options">
          {choices.map(({ value, label, description, icon: Icon }) => <label className="theme-option" key={value}>
            <input type="radio" name={`${id}-theme`} value={value} checked={preference === value} aria-label={label}
              aria-describedby={`${id}-${value}-description`} onChange={() => setPreference(value)} />
            <span className="theme-option-body">
              <span className={`theme-preview theme-preview-${value}`} aria-hidden="true">
                {value === 'system' ? <><Preview theme="light" /><Preview theme="dark" /></> : <Preview theme={value} />}
              </span>
              <span className="theme-option-title"><Icon /><strong>{label}</strong><span className="theme-radio-mark" /></span>
              <span className="theme-option-description" id={`${id}-${value}-description`}>{description}</span>
            </span>
          </label>)}
        </div>
      </fieldset>
      <AccentSettings />
      <div className="theme-current" role="status" aria-live="polite" aria-atomic="true">
        {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
        <p><strong>{preference === 'system' ? `Following your device · ${resolvedTheme} mode` : `${resolvedTheme === 'dark' ? 'Dark' : 'Light'} theme active`}</strong>
          <span>{persisted ? 'Applied instantly. Your preference is remembered in this browser.' : 'Applied for this visit. Your browser could not save the preference.'}</span></p>
      </div>
    </div>
    <p className="theme-tip">Use the sun or moon in the top bar for a quick switch. Choose Follow device here to return to automatic mode.</p>
  </>
}
