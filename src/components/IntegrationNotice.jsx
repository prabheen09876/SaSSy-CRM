import { useApp } from '../App.jsx'
import { hasConfig, workerUrl } from '../lib/supabase'

export const integrationsConfigured = hasConfig && Boolean(workerUrl)

export default function IntegrationNotice({ feature = 'Messaging' }) {
  const { demo, goto, can } = useApp()
  return <div className="integration-notice" role="note">
    <div><strong>{demo ? `${feature} preview` : integrationsConfigured ? `${feature} needs a provider` : `${feature} is not connected`}</strong>
      <p>{demo ? 'Actions here use sample data. No messages or account emails are sent.' : integrationsConfigured
        ? 'A gateway URL is configured. These actions also require an installed provider service; the included connection-check gateway does not send messages or run automations. Review availability in Settings.'
        : 'Connect your business’s integration service to use these actions. Your contacts and pipeline work without it.'}</p></div>
    {can('settings.view') && <button className="btn sm" onClick={() => goto('settings')}>View connections</button>}
  </div>
}
