import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import IntegrationNotice from './IntegrationNotice.jsx'
import {
  loadAutomations, updateAutomation, runAutomation,
  loadTemplates, insertTemplate, updateTemplate, deleteTemplate, fmtDate, uploadMedia,
} from '../lib/db'
import { CHANNELS, channelLabel, channelPill, triggerLabel } from '../lib/constants'
import { Zap, Sparkle, Send, FileText, Plus, Check, X, Trash, Chat, Phone } from '../lib/icons.jsx'

const ACCEPT = { image: 'image/*', video: 'video/*', document: 'application/pdf' }
const isReviewedFollowup = (automation) =>
  automation?.systemKey === 'lead_followup_due_whatsapp'
  || (automation?.trigger === 'lead.idle.3d' && automation?.channel === 'whatsapp')

// Upload a media file to Cloudflare R2 (via the Worker) and store the returned URL.
// Falls back to pasting a URL, so it still works before R2 is switched on.
function MediaUpload({ value, onChange, accept, label = 'file' }) {
  const { notify } = useApp()
  const [busy, setBusy] = useState(false)
  const [showUrl, setShowUrl] = useState(false)
  const inputRef = useRef(null)
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try { onChange(await uploadMedia(file)); notify('Uploaded') }
    catch (err) { notify('Upload failed: ' + err.message, true) }
    finally { setBusy(false) }
  }
  const isImg = value && /\.(png|jpe?g|webp|gif)$/i.test(value)
  return (
    <div style={{ marginTop: 6 }}>
      <input ref={inputRef} type="file" accept={accept} onChange={onFile} style={{ display: 'none' }} />
      {value ? (
        <div className="row-between" style={{ gap: 8, padding: 8, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {isImg
              ? <img src={value} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} />
              : <span className="lr-ico" style={{ width: 34, height: 34 }}><FileText /></span>}
            <span className="faint" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{String(value).split('/').pop()}</span>
          </span>
          <button type="button" className="btn ghost sm" onClick={() => onChange('')}><X /> Remove</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : <><Plus /> Upload {label}</>}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setShowUrl((v) => !v)}>or paste URL</button>
          {showUrl && <input value="" onChange={(e) => onChange(e.target.value)} placeholder="https://…" style={{ flexBasis: '100%' }} />}
        </div>
      )}
    </div>
  )
}

const tileStyle = {
  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
  background: 'var(--brand-soft)', color: 'var(--brand-fg)',
  display: 'grid', placeItems: 'center',
}

// ---- template helpers -------------------------------------------------------
const BTN_TYPES = [
  { v: 'quick_reply', l: 'Quick reply' },
  { v: 'url', l: 'Visit URL' },
  { v: 'call', l: 'Call' },
]
const btnTypeLabel = (t) => BTN_TYPES.find((x) => x.v === t)?.l || t
const HEADER_TYPES = [
  { v: 'none', l: 'None' },
  { v: 'text', l: 'Text' },
  { v: 'image', l: 'Image' },
  { v: 'video', l: 'Video' },
  { v: 'document', l: 'Document (PDF)' },
]
const mediaLabel = (h) =>
  ({ image: 'IMAGE', video: 'VIDEO', document: 'PDF', text: 'TEXT' }[h] || '')

// Fill defaults so seeded templates (name/channel/subject/body only) render.
const withDefaults = (t) => ({
  id: t.id,
  name: t.name || '',
  channel: t.channel || 'email',
  category: t.category || 'utility',
  headerType: t.headerType || 'none',
  headerText: t.headerText || '',
  headerMedia: t.headerMedia || '',
  subject: t.subject || '',
  body: t.body || '',
  footer: t.footer || '',
  buttons: Array.isArray(t.buttons) ? t.buttons : [],
  cards: Array.isArray(t.cards) ? t.cards : [],
})

function RuleCard({ a, canEdit, onToggle, onRun }) {
  const [busy, setBusy] = useState(false)
  const Icon = a.channel === 'ai' ? Sparkle : Zap
  const reviewedFollowup = isReviewedFollowup(a)

  const toggle = async () => {
    if (!canEdit || busy) return
    setBusy(true)
    try { await onToggle(a) } finally { setBusy(false) }
  }
  const run = async () => {
    if (busy) return
    setBusy(true)
    try { await onRun(a) } finally { setBusy(false) }
  }

  return (
    <div className="panel">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: 1 }}>
          <span style={tileStyle}><Icon /></span>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 14, display: 'block' }}>{a.name}</strong>
            {a.description && (
              <div className="faint" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>
                {a.description}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <span className="badge">{triggerLabel(a.trigger)}</span>
              <span className={'pill ' + channelPill(a.channel)}>
                <span className="dot" />{channelLabel(a.channel)}
              </span>
            </div>
          </div>
        </div>
        <div className="automation-switch-wrap">
          <span className={'automation-state ' + (a.enabled ? 'on' : 'off')}>
            {a.enabled
              ? (reviewedFollowup ? 'Allowed · approval required' : 'Active')
              : 'Paused'}
          </span>
          <button
            className="switch" role="switch" aria-checked={!!a.enabled}
            aria-label={(a.enabled ? 'Pause ' : 'Allow ') + a.name} disabled={!canEdit || busy}
            onClick={toggle}
          />
        </div>
      </div>

      {reviewedFollowup && (
        <div className={'automation-safety ' + (a.enabled ? 'allowed' : 'paused')}>
          <strong>{a.enabled ? 'Manual approval mode' : 'Sending blocked'}</strong>
          <span>
            {a.enabled
              ? 'The CRM can prepare due follow-ups, but a manager must review and type SEND every time.'
              : 'No follow-up WhatsApps can send. Universal welcomes, login codes, and manual messages are unaffected.'}
          </span>
        </div>
      )}

      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          Last run {a.lastRun ? fmtDate(a.lastRun) : 'never'} · {a.runCount || 0} sent
        </span>
        {canEdit && (
          <button className="btn sm" onClick={run} disabled={busy || !a.enabled}>
            <Send /> {reviewedFollowup ? 'Review due' : 'Run now'}
          </button>
        )}
      </div>
    </div>
  )
}

function TemplateCard({ t, canEdit, onEdit, onDelete }) {
  const buttons = Array.isArray(t.buttons) ? t.buttons : []
  const cards = Array.isArray(t.cards) ? t.cards : []
  const hasHeader = t.headerType && t.headerType !== 'none'

  return (
    <div className="panel">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>{t.name}</strong>
            <span className={'pill ' + channelPill(t.channel)}>
              <span className="dot" />{channelLabel(t.channel)}
            </span>
            {t.category && <span className="badge">{t.category === 'marketing' ? 'Marketing' : 'Utility'}</span>}
          </div>

          {(hasHeader || buttons.length > 0 || cards.length > 0) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {hasHeader && (
                <span className="badge">
                  <FileText /> {t.headerType === 'text' ? 'Text header' : (mediaLabel(t.headerType) + ' header')}
                </span>
              )}
              {buttons.length > 0 && (
                <span className="badge">
                  <Chat /> ▸ {buttons.length} button{buttons.length > 1 ? 's' : ''}
                </span>
              )}
              {cards.length > 0 && (
                <span className="badge">▸ carousel · {cards.length}</span>
              )}
            </div>
          )}

          {t.channel === 'email' && t.subject && (
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
              Subject: {t.subject}
            </div>
          )}
          <div style={{
            whiteSpace: 'pre-wrap', color: 'var(--ink-2)', fontSize: 13, marginTop: 8,
            display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {t.body}
          </div>
        </div>
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => onEdit(t)}>Edit</button>
          <button className="btn danger sm" aria-label={'Delete ' + t.name} onClick={() => onDelete(t)}>
            <Trash /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---- preview ----------------------------------------------------------------
function ButtonChip({ b }) {
  const Icon = b.type === 'call' ? Phone : b.type === 'url' ? Send : Chat
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'center',
      padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
      background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--brand-fg)',
    }}>
      <Icon /> {b.text || btnTypeLabel(b.type)}
    </span>
  )
}

function MediaTile({ type, url }) {
  const isImg = type === 'image' && !!url
  if (isImg) {
    return (
      <img src={url} alt="" style={{
        display: 'block', width: '100%', maxHeight: 140, objectFit: 'cover',
        borderRadius: 8, marginBottom: 8,
      }} />
    )
  }
  return (
    <div style={{
      height: 84, borderRadius: 8, marginBottom: 8, display: 'grid', placeItems: 'center',
      background: 'var(--brand-soft)', color: 'var(--brand-fg)',
      fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
    }}>
      {mediaLabel(type) || 'MEDIA'}
    </div>
  )
}

function Bubble({ headerType, headerText, headerMedia, body, footer, buttons, cardTag }) {
  const btns = (buttons || []).filter((b) => b.text || b.value)
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--msg-out-border)',
      borderRadius: '4px 12px 12px 12px', padding: 10, boxShadow: 'var(--shadow)',
      maxWidth: 300, fontSize: 13, position: 'relative',
    }}>
      {cardTag && (
        <span style={{
          position: 'absolute', top: 8, right: 8, zIndex: 1,
          padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
          background: 'var(--overlay)', color: 'var(--on-brand)',
        }}>{cardTag}</span>
      )}
      {headerType === 'text' && headerText && (
        <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--ink)' }}>{headerText}</div>
      )}
      {headerType && headerType !== 'none' && headerType !== 'text' && (
        <MediaTile type={headerType} url={headerMedia} />
      )}
      {body ? (
        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: 1.5 }}>{body}</div>
      ) : (
        <div className="faint" style={{ fontStyle: 'italic' }}>Message body…</div>
      )}
      {footer && (
        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{footer}</div>
      )}
      {btns.length > 0 && (
        <div style={{ display: 'grid', gap: 5, marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          {btns.map((b, i) => <ButtonChip key={i} b={b} />)}
        </div>
      )}
    </div>
  )
}

function Preview({ channel, subject, headerType, headerText, headerMedia, body, footer, buttons, cards }) {
  if (channel === 'email') {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
        padding: 12, boxShadow: 'var(--shadow)', fontSize: 13,
      }}>
        <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Subject</div>
        <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{subject || '(no subject)'}</div>
        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: 1.5 }}>
          {body || <span className="faint" style={{ fontStyle: 'italic' }}>Message body…</span>}
        </div>
      </div>
    )
  }

  const hasCards = channel === 'whatsapp' && cards.length > 0
  const first = hasCards ? cards[0] : null

  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
      padding: 14,
    }}>
      {first ? (
        <Bubble
          headerType={first.image ? 'image' : 'none'}
          headerMedia={first.image}
          body={first.body}
          buttons={first.buttons}
          cardTag={'1/' + cards.length}
        />
      ) : (
        <Bubble
          headerType={headerType} headerText={headerText} headerMedia={headerMedia}
          body={body} footer={footer} buttons={buttons}
        />
      )}
    </div>
  )
}

// ---- sub-editors ------------------------------------------------------------
function ButtonRow({ b, allowValue, onChange, onRemove }) {
  const isValue = b.type === 'url' || b.type === 'call'
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ flex: '1 1 120px', minWidth: 110 }}>
        <label>Type</label>
        <select value={b.type} onChange={(e) => onChange({ ...b, type: e.target.value })}>
          {BTN_TYPES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 120px', minWidth: 110 }}>
        <label>Label</label>
        <input value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} placeholder="Button text" />
      </div>
      {allowValue && isValue && (
        <div className="field" style={{ flex: '1 1 140px', minWidth: 120 }}>
          <label>{b.type === 'call' ? 'Phone' : 'URL'}</label>
          <input
            value={b.value}
            onChange={(e) => onChange({ ...b, value: e.target.value })}
            placeholder={b.type === 'call' ? '+91 …' : 'https://…'}
          />
        </div>
      )}
      <button className="icon-btn" aria-label="Remove button" onClick={onRemove} style={{ marginBottom: 1 }}>
        <Trash />
      </button>
    </div>
  )
}

function CardEditor({ c, index, onChange, onRemove }) {
  const b = c.buttons && c.buttons[0] ? c.buttons[0] : null
  const setBtn = (nb) => onChange({ ...c, buttons: nb ? [nb] : [] })
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 12,
      background: 'var(--surface-2)',
    }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong className="faint" style={{ fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          Card {index + 1}
        </strong>
        <button className="icon-btn" aria-label={'Remove card ' + (index + 1)} onClick={onRemove}><Trash /></button>
      </div>
      <div className="stack">
        <div className="field">
          <label>Image</label>
          <MediaUpload value={c.image} accept="image/*" label="image" onChange={(url) => onChange({ ...c, image: url })} />
        </div>
        <div className="field">
          <label>Body</label>
          <textarea value={c.body} onChange={(e) => onChange({ ...c, body: e.target.value })}
            style={{ minHeight: 56 }} placeholder="Card text…" />
        </div>
        {b ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 110px', minWidth: 100 }}>
              <label>Button</label>
              <select value={b.type} onChange={(e) => setBtn({ ...b, type: e.target.value })}>
                {BTN_TYPES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 110px', minWidth: 100 }}>
              <label>Label</label>
              <input value={b.text} onChange={(e) => setBtn({ ...b, text: e.target.value })} placeholder="Button text" />
            </div>
            {(b.type === 'url' || b.type === 'call') && (
              <div className="field" style={{ flex: '1 1 130px', minWidth: 110 }}>
                <label>{b.type === 'call' ? 'Phone' : 'URL'}</label>
                <input value={b.value} onChange={(e) => setBtn({ ...b, value: e.target.value })}
                  placeholder={b.type === 'call' ? '+91 …' : 'https://…'} />
              </div>
            )}
            <button className="icon-btn" aria-label="Remove card button" onClick={() => setBtn(null)} style={{ marginBottom: 1 }}>
              <Trash />
            </button>
          </div>
        ) : (
          <button className="btn sm" onClick={() => setBtn({ type: 'quick_reply', text: '', value: '' })}>
            <Plus /> Add button
          </button>
        )}
      </div>
    </div>
  )
}

function TemplateEditor({ initial, onClose, onSave }) {
  const start = withDefaults(initial || {})
  const editing = !!(initial && initial.id)
  const [name, setName] = useState(start.name)
  const [channel, setChannel] = useState(start.channel)
  const [category, setCategory] = useState(start.category)
  const [headerType, setHeaderType] = useState(start.headerType)
  const [headerText, setHeaderText] = useState(start.headerText)
  const [headerMedia, setHeaderMedia] = useState(start.headerMedia)
  const [subject, setSubject] = useState(start.subject)
  const [body, setBody] = useState(start.body)
  const [footer, setFooter] = useState(start.footer)
  const [buttons, setButtons] = useState(start.buttons)
  const [cards, setCards] = useState(start.cards)
  const [saving, setSaving] = useState(false)

  const isWa = channel === 'whatsapp'
  const isEmail = channel === 'email'
  const waish = isWa || channel === 'sms'   // WhatsApp-style fields (also SMS)

  const setButtonAt = (i, nb) => setButtons((cur) => cur.map((b, x) => (x === i ? nb : b)))
  const removeButton = (i) => setButtons((cur) => cur.filter((_, x) => x !== i))
  const addButton = () => setButtons((cur) => cur.length >= 3 ? cur : [...cur, { type: 'quick_reply', text: '', value: '' }])

  const setCardAt = (i, nc) => setCards((cur) => cur.map((c, x) => (x === i ? nc : c)))
  const removeCard = (i) => setCards((cur) => cur.filter((_, x) => x !== i))
  const addCard = () => setCards((cur) => cur.length >= 10 ? cur : [...cur, { image: '', body: '', buttons: [] }])

  const canSave = !!name.trim() && !!body.trim()

  const save = async () => {
    if (saving || !canSave) return
    setSaving(true)
    const fields = {
      name: name.trim(),
      channel,
      category: waish ? category : 'utility',
      headerType: waish ? headerType : 'none',
      headerText: waish && headerType === 'text' ? headerText : '',
      headerMedia: waish && (headerType === 'image' || headerType === 'video' || headerType === 'document') ? headerMedia : '',
      subject: isEmail ? subject : '',
      body,
      footer: waish ? footer : '',
      buttons: waish ? buttons.filter((b) => b.text || b.value) : [],
      cards: isWa ? cards.filter((c) => c.image || c.body || (c.buttons && c.buttons.length)) : [],
    }
    try { await onSave(editing ? initial.id : null, fields) } finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h2>{editing ? 'Edit template' : 'New template'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {/* form column */}
            <div className="stack">
              <div className="field">
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day-1 welcome" />
              </div>
              <div className="field">
                <label>Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.filter((c) => c.v !== 'ai' && c.v !== 'whatsapp').map((c) => (
                    <option key={c.v} value={c.v}>{c.l}</option>
                  ))}
                </select>
              </div>

              {isEmail && (
                <div className="field">
                  <label>Subject</label>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line" />
                </div>
              )}

              {waish && (
                <div className="field">
                  <label>Category</label>
                  <div className="seg" role="tablist" aria-label="Category">
                    <button role="tab" aria-selected={category === 'utility'} onClick={() => setCategory('utility')}>Utility</button>
                    <button role="tab" aria-selected={category === 'marketing'} onClick={() => setCategory('marketing')}>Marketing</button>
                  </div>
                </div>
              )}

              {waish && (
                <div className="field">
                  <label>Header</label>
                  <select value={headerType} onChange={(e) => setHeaderType(e.target.value)}>
                    {HEADER_TYPES.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
                  </select>
                  {headerType === 'text' && (
                    <input value={headerText} onChange={(e) => setHeaderText(e.target.value)}
                      placeholder="Header text" style={{ marginTop: 6 }} />
                  )}
                  {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                    <MediaUpload value={headerMedia} accept={ACCEPT[headerType]}
                      label={headerType === 'document' ? 'PDF' : headerType} onChange={setHeaderMedia} />
                  )}
                </div>
              )}

              <div className="field">
                <label>Body</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 140 }}
                  placeholder="Hi {{name}}, …" />
                <span className="faint" style={{ fontSize: 11.5 }}>
                  Variables: {'{{name}}'}{waish ? ', {{date}}, {{time}}' : ''}
                </span>
              </div>

              {waish && (
                <div className="field">
                  <label>Footer</label>
                  <input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Optional small print" />
                </div>
              )}

              {waish && (
                <div className="field">
                  <label>Buttons</label>
                  <div className="stack">
                    {buttons.map((b, i) => (
                      <ButtonRow
                        key={i} b={b} allowValue
                        onChange={(nb) => setButtonAt(i, nb)}
                        onRemove={() => removeButton(i)}
                      />
                    ))}
                    {buttons.length < 3 && (
                      <button className="btn sm" onClick={addButton}><Plus /> Add button</button>
                    )}
                    {buttons.length >= 3 && (
                      <span className="faint" style={{ fontSize: 11.5 }}>Max 3 buttons.</span>
                    )}
                  </div>
                </div>
              )}

              {isWa && (
                <div className="field">
                  <label>Carousel cards</label>
                  <div className="stack">
                    {cards.map((c, i) => (
                      <CardEditor
                        key={i} c={c} index={i}
                        onChange={(nc) => setCardAt(i, nc)}
                        onRemove={() => removeCard(i)}
                      />
                    ))}
                    {cards.length < 10 && (
                      <button className="btn sm" onClick={addCard}><Plus /> Add card</button>
                    )}
                    {cards.length >= 10 && (
                      <span className="faint" style={{ fontSize: 11.5 }}>Max 10 cards.</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* preview column */}
            <div>
              <div className="field" style={{ position: 'sticky', top: 0 }}>
                <label>Preview</label>
                <Preview
                  channel={channel} subject={subject}
                  headerType={headerType} headerText={headerText} headerMedia={headerMedia}
                  body={body} footer={footer} buttons={buttons} cards={cards}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="mfoot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || !canSave}>
            <Check /> {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Automations({ leads }) {
  const { notify, can, me } = useApp()
  const [view, setView] = useState('rules')
  const [autos, setAutos] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)   // null | {} (new) | template (edit)
  const [approval, setApproval] = useState(null)
  const [approvalText, setApprovalText] = useState('')
  const [approvalBusy, setApprovalBusy] = useState(false)

  const canEditAutos = can('automations.edit') && ['admin', 'sub-admin'].includes(me?.role)
  const canEditTpl = can('templates.edit')

  useEffect(() => {
    let alive = true
    Promise.all([loadAutomations(), loadTemplates()]).then(([a, t]) => {
      if (!alive) return
      setAutos(a)
      setTemplates(t)
      setLoading(false)
    }).catch((error) => { if (alive) { notify('Could not load automations: ' + error.message, true); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const onToggle = async (a) => {
    const next = !a.enabled
    try {
      const saved = await updateAutomation(a.id, { enabled: next })
      setAutos((cur) => cur.map((x) => (
        x.id === a.id ? { ...x, enabled: saved.enabled, systemKey: saved.systemKey || x.systemKey } : x
      )))
      notify(a.name + (saved.enabled ? ' allowed' : ' paused'))
    } catch (error) {
      notify('Switch not saved: ' + error.message, true)
      setAutos(await loadAutomations())
    }
  }

  const onRun = async (a) => {
    try {
      const result = await runAutomation(a.id)
      if (result.requiresConfirmation) {
        if (result.pendingCount === 0) {
          notify('No due, unsent follow-up reminders to review')
          return
        }
        setApproval({ automation: a, ...result })
        setApprovalText('')
        return
      }
      notify(a.channel === 'ai' ? ('Scored ' + result.count + ' records') : ('Queued for ' + result.count + ' records'))
      setAutos(await loadAutomations())
    } catch (error) {
      notify('Could not run: ' + error.message, true)
    }
  }

  const approveFollowups = async () => {
    if (!approval || approvalText.trim().toUpperCase() !== 'SEND' || approvalBusy) return
    setApprovalBusy(true)
    try {
      const result = await runAutomation(approval.automation.id, { confirm: true, confirmation: 'SEND' })
      notify(result.count
        ? `${result.count} reviewed reminder${result.count === 1 ? '' : 's'} queued${result.remaining ? ` · ${result.remaining} still due` : ''}`
        : 'No reminders were queued')
      setApproval(null)
      setApprovalText('')
      setAutos(await loadAutomations())
    } catch (error) {
      notify('Approval failed: ' + error.message, true)
    } finally {
      setApprovalBusy(false)
    }
  }

  const saveTemplate = async (id, fields) => {
    if (id) await updateTemplate(id, fields)
    else await insertTemplate(fields)
    setTemplates(await loadTemplates())
    notify(id ? 'Template saved' : 'Template added')
    setEditor(null)
  }

  const removeTemplate = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    await deleteTemplate(t.id)
    setTemplates(await loadTemplates())
    notify('Template deleted')
  }

  return (
    <>
      <IntegrationNotice feature="Automations" />
      <div className="page-head">
        <div>
          <span className="ttl">Automations</span>
          <p className="sub">
            Control messaging rules. Follow-up WhatsApps never send on a schedule; every batch needs manager approval.
          </p>
        </div>
        <div className="actions">
          <div className="seg" role="tablist" aria-label="Automations view">
            <button role="tab" aria-selected={view === 'rules'} onClick={() => setView('rules')}>Rules</button>
            <button role="tab" aria-selected={view === 'templates'} onClick={() => setView('templates')}>Templates</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="empty"><div className="spinner" /></div>
      ) : view === 'rules' ? (
        autos.length === 0 ? (
          <div className="panel empty"><Zap /><p>No automation rules yet.</p></div>
        ) : (
          <div className="stack">
            {autos.map((a) => (
              <RuleCard key={a.id} a={a} canEdit={canEditAutos} onToggle={onToggle} onRun={onRun} />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="row-between" style={{ marginBottom: 12, gap: 12 }}>
            <span className="faint" style={{ fontSize: 12 }}>
              WhatsApp templates are read-only here and are authored and approved in Meta WhatsApp Manager.
            </span>
            {canEditTpl && (
              <button className="btn primary" onClick={() => setEditor({ channel: 'email' })}>
                <Plus /> Add email template
              </button>
            )}
          </div>
          {templates.length === 0 ? (
            <div className="panel empty"><FileText /><p>No message templates yet.</p></div>
          ) : (
            <div className="stack">
              {templates.map((t) => (
                <TemplateCard key={t.id} t={t} canEdit={canEditTpl && t.channel !== 'whatsapp'} onEdit={setEditor} onDelete={removeTemplate} />
              ))}
            </div>
          )}
        </>
      )}

      {approval && (
        <div className="overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !approvalBusy) setApproval(null)
        }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="followup-approval-title">
            <div className="mhead">
              <div>
                <h2 id="followup-approval-title">Human verification required</h2>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>Nothing has been sent yet</div>
              </div>
              <button className="icon-btn" aria-label="Cancel approval" onClick={() => setApproval(null)} disabled={approvalBusy}><X /></button>
            </div>
            <div className="mbody">
              <div className="approval-count">{approval.batchSize}</div>
              <p style={{ marginTop: 6, lineHeight: 1.55 }}>
                You are approving up to <strong>{approval.batchSize}</strong> of <strong>{approval.pendingCount}</strong> due, unsent follow-up reminders.
              </p>
              <div className="automation-safety paused" style={{ marginTop: 14 }}>
                <strong>Automatic daily sending is off</strong>
                <span>Each record and follow-up date can be accepted only once. Pausing the rule before delivery blocks the queued message too.</span>
              </div>
              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="followup-approval-text">Type SEND to confirm</label>
                <input
                  id="followup-approval-text"
                  autoFocus
                  autoComplete="off"
                  value={approvalText}
                  onChange={(event) => setApprovalText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') approveFollowups() }}
                  placeholder="SEND"
                />
              </div>
            </div>
            <div className="mfoot">
              <button className="btn ghost" onClick={() => setApproval(null)} disabled={approvalBusy}>Cancel</button>
              <button
                className="btn primary"
                onClick={approveFollowups}
                disabled={approvalBusy || approvalText.trim().toUpperCase() !== 'SEND'}
              >
                <Check /> {approvalBusy ? 'Approving…' : `Approve ${approval.batchSize}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {editor && (
        <TemplateEditor initial={editor} onClose={() => setEditor(null)} onSave={saveTemplate} />
      )}
    </>
  )
}
