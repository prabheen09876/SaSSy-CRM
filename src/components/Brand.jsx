export default function Brand({ name = 'Workspace CRM' }) {
  return <div className="brand workspace-brand" title={name}>
    <svg className="workspace-brand-symbol" width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M7 8h18v16H7z" stroke="currentColor" strokeWidth="2" rx="3" />
      <path d="M12 4v8M20 20v8M4 16h8M20 16h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <span className="workspace-brand-name">{name}</span>
  </div>
}
