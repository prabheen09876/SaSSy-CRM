import { Component } from 'react'
import Brand from './Brand.jsx'

// Stops one component's runtime error from white-screening the whole CRM.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('[CRM] render error:', err, info) }

  render() {
    if (!this.state.err) return this.props.children
    if (this.props.inline) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '44px 20px' }}>
          <p className="lead" style={{ marginBottom: 6 }}>This section hit an error.</p>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>Switch to another tab, or reload — your data is safe.</p>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={() => location.reload()}>Reload</button>
        </div>
      )
    }
    return (
      <div className="login-wrap">
        <div className="login" style={{ textAlign: 'center' }}>
          <Brand />
          <p className="lead" style={{ marginTop: 12 }}>Something went wrong on this screen.</p>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Your data is safe. Reload to continue — if it keeps happening, take a screenshot and let us know.
          </p>
          <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
