import { Phone } from '../lib/icons.jsx'
import { telephoneHref } from '../lib/phone.js'
import './call-lead.css'

export default function CallLeadButton({ phone, name }) {
  const href = telephoneHref(phone)
  if (!href) return null
  // A standard telephone link leaves the final call action to the device.
  // Do not record a completed call merely because the dialer was opened.
  return <a className="btn lead-call-btn" href={href} aria-label={`Call ${name || 'this contact'}`}
    title={`Open phone dialer for ${phone}`} onClick={(event) => event.stopPropagation()}>
    <Phone aria-hidden="true" /><span>Call</span>
  </a>
}
