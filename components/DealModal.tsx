'use client'

import { Fragment, useRef, useCallback, useState, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG } from '@/lib/config'
import { patchLead as patchLeadApi, fetchLeadPropertyOptions, fetchAssociatedDeal, fetchLeadContact, buildSchedulerUrl, fetchContactActivity, ACTIVITY_CAP, createHsTask, deleteHsTask, fetchDirectAppointmentDeals, fetchContactDetails, patchContact, ContactEmailTakenError } from '@/lib/hubspot'
import type { Activity, ActivityKind, ActivityGroups, DirectDeal, ContactDetails } from '@/lib/hubspot'
import { PHONE_COUNTRIES_TOP, phoneCountryOf, detectPhoneCountry, loadPhoneCountries, normalizePhone } from '@/lib/phone'
import type { PhoneCountry, PhoneCountryOption } from '@/lib/phone'
import { getPlaybookDefs } from '@/lib/playbooks'
import { dealOpenTasks, loadCollapsedActivity, saveCollapsedActivity } from '@/lib/storage'
import { showToast } from './Toast'
import PlaybookView from './PlaybookView'
import ErrorBoundary from './ErrorBoundary'
import type { Deal, Scheduler, PlaybookState, Playbook } from '@/lib/types'

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function getScheduler(deal: Deal, scheds: Scheduler[]): Scheduler | null {
  if (!scheds.length) return null
  const prod = (deal?.properties?.[CONFIG.PROPS.product] || '').toLowerCase()
  // Match against productMatches array (new) or legacy productMatch string
  const byProduct = scheds.find(s => {
    const matches = s.productMatches && s.productMatches.length > 0
      ? s.productMatches
      : s.productMatch ? [s.productMatch] : []
    return matches.some(m => prod.includes(m.toLowerCase()))
  })
  return byProduct || scheds.find(s => s.isDefault) || scheds[0]
}

// ── Modals ────────────────────────────────────────────────────────────────────
// ── Inline editable field ─────────────────────────────────────────────────────
// ── Pill icons ────────────────────────────────────────────────────────────────
// Line icons for the modal's pill buttons. Drawn in currentColor, so each icon
// takes the colour of its button, including the grey of a disabled one.
const PILL_ICONS = {
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  home: <><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  video: <><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>,
  calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
}

// pointer-events: none so a click on the icon lands on the button or link
// itself. The Call link relies on this: Aircall's extension picks up clicks on
// the tel: link, and a click target of an inner <path> could slip past it.
function PillIcon({ name }: { name: keyof typeof PILL_ICONS }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, pointerEvents: 'none' }}>
      {PILL_ICONS[name]}
    </svg>
  )
}

/**
 * Scheduler button labels are set by admins and may already start with an
 * emoji (the old default did). The button now carries its own icon, so a
 * leading symbol is dropped rather than shown twice.
 */
function stripLeadingSymbol(label: string): string {
  return label.replace(/^[^\w\s\u00C0-\u024F(]+\s*/, '') || label
}

// ── Activity timeline ─────────────────────────────────────────────────────────

/** How many rows of a group show before the rep asks for the rest. */
const ACTIVITY_PREVIEW = 3

function actDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function actDateTime(iso: string): string {
  const d = new Date(iso)
  return `${actDate(iso)} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Each group gets its own columns: what matters about an email is not what
 * matters about a call. Status values are shown as HubSpot returns them
 * (BOUNCED, NO_ANSWER, NO_SHOW) so they match the record exactly; direction is
 * derived, because HubSpot's raw values there are unreadable.
 */
type Slots = [string, string, string, string, string]

interface GroupDef {
  kind: ActivityKind
  icon: string
  titleKey: string
  /** Five fixed slots so every group lines up: when · wie · richting · inhoud · status. */
  headerKeys: Slots
  cells: (a: Activity) => Slots
  /** Slot carrying the content — gets .tn (bold, ellipsised); rest get .tm. */
  mainCol: number
}

/**
 * One shared column grid for every group, sized off the widest (four columns).
 * Groups that do not use a slot leave it blank rather than collapsing it, so
 * dates sit under dates and statuses under statuses right down the section.
 * Percentages, not pixels: the timeline sits in the modal's left column, whose
 * width changes with the window and with the rep resizing the modal.
 */
const ACTIVITY_COLS = (
  <colgroup>
    <col style={{ width: '18%' }} />
    <col style={{ width: '16%' }} />
    <col style={{ width: '15%' }} />
    <col />
    <col style={{ width: '21%' }} />
  </colgroup>
)

// .tn caps at 200px, which fights the fixed grid — the col width should win.
const ACTIVITY_CELL: React.CSSProperties = {
  maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const ACTIVITY_GROUPS: GroupDef[] = [
  {
    kind: 'email', icon: '✉', titleKey: 'actEmails',
    headerKeys: ['actDateTime', 'actBy', 'actDirection', 'actSubject', 'actStatus'],
    cells: a => [actDateTime(a.at), a.author || '--', a.direction || '--', a.title || '--', a.status || '--'],
    mainCol: 3,
  },
  {
    kind: 'call', icon: '☎', titleKey: 'actCalls',
    // No call title: it is usually auto-generated and says less than the
    // direction and duration already do.
    headerKeys: ['actDateTime', 'actBy', 'actDirection', 'actDuration', 'actResult'],
    cells: a => [actDateTime(a.at), a.author || '--', a.direction || '--', a.duration || '--', a.status || '--'],
    mainCol: 4,
  },
  {
    kind: 'meeting', icon: '📅', titleKey: 'actMeetings',
    headerKeys: ['actDateTime', 'actBy', '', 'actSubject', 'actOutcome'],
    cells: a => [actDateTime(a.at), a.author || '--', '', a.title || '--', a.status || '--'],
    mainCol: 3,
  },
  {
    kind: 'note', icon: '✎', titleKey: 'actNotes',
    // Date only: a note is not a moment in a conversation the way a call is.
    headerKeys: ['actDate', 'actFrom', '', 'actFirstLine', ''],
    cells: a => [actDate(a.at), a.author || '--', '', a.title || '--', ''],
    mainCol: 3,
  },
  {
    kind: 'marketing', icon: '📣', titleKey: 'actMarketing',
    // Status is the furthest the recipient got: SENT → DELIVERED → OPEN → CLICK,
    // or a failure such as BOUNCE.
    headerKeys: ['actDateTime', '', '', 'actSubject', 'actStatus'],
    cells: a => [actDateTime(a.at), '', '', a.title || '--', a.status || '--'],
    mainCol: 3,
  },
]

function ActivityGroup({
  def, items, lang, collapsed, onToggle,
}: {
  def: GroupDef; items: Activity[]; lang: 'nl' | 'en'
  collapsed: boolean; onToggle: () => void
}) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // The fetch returns one row past the cap purely as a truncation signal, so
  // the extra row is dropped here and reported as "7+" instead.
  const truncated = items.length > ACTIVITY_CAP
  const rows = items.slice(0, ACTIVITY_CAP)
  const visible = showAll ? rows : rows.slice(0, ACTIVITY_PREVIEW)
  const hidden = rows.length - visible.length

  return (
    <div style={{ marginTop: 10 }}>
      {/* Heading stays visible when folded, count included — a rep who has
          collapsed a group can still see whether there is anything in it. */}
      <div
        className="sl2"
        style={{ marginBottom: 4, cursor: 'pointer', userSelect: 'none' }}
        onClick={onToggle}
      >
        {def.icon} {t(def.titleKey)}{' '}
        <span style={{ color: 'var(--cs)' }}>({rows.length}{truncated ? '+' : ''})</span>{' '}
        <span style={{ color: 'var(--cs)' }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (<>
      <table className="act-tbl" style={{ tableLayout: 'fixed', width: '100%' }}>
        {ACTIVITY_COLS}
        <thead>
          {/* An unused slot keeps its cell so the grid holds across groups. */}
          <tr>{def.headerKeys.map((k, i) => <th key={i}>{k ? t(k) : ''}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map(a => {
            const isOpen = openId === a.id
            const cells = def.cells(a)
            return (
              <Fragment key={a.id}>
                <tr
                  style={{ cursor: a.body ? 'pointer' : 'default' }}
                  onClick={() => a.body && setOpenId(isOpen ? null : a.id)}
                >
                  {cells.map((c, i) => (
                    <td key={i} className={i === def.mainCol ? 'tn' : 'tm'} style={ACTIVITY_CELL} title={c}>
                      {i === def.mainCol && a.body
                        ? <>{c} <span style={{ color: 'var(--cs)' }}>{isOpen ? '▾' : '▸'}</span></>
                        : c}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={cells.length} style={{
                      fontSize: 12, color: 'var(--cs)', whiteSpace: 'pre-wrap',
                      padding: '6px 8px', background: 'var(--c2)',
                    }}>{a.body}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button className="btn btn-sc btn-xs" style={{ marginTop: 4 }} onClick={() => setShowAll(true)}>
          {t('actShowAll', String(rows.length))}
        </button>
      )}
      {showAll && rows.length > ACTIVITY_PREVIEW && (
        <button className="btn btn-sc btn-xs" style={{ marginTop: 4 }} onClick={() => setShowAll(false)}>
          {t('actShowLess')}
        </button>
      )}
      {/* Only worth saying when there is genuinely more than the cap shows. */}
      {truncated && (
        <div style={{ fontSize: 11, color: 'var(--cs)', marginTop: 4 }}>{t('actMore')}</div>
      )}
      </>)}
    </div>
  )
}

/**
 * Recent communication on the lead's contact, so a rep can see what has already
 * been said without leaving for HubSpot.
 *
 * Loaded when the modal opens rather than on expand: the point is that the rep
 * sees there is history at all. Collapsed by default so it never pushes the
 * playbook down the page. Empty groups are dropped — four headings reading
 * "geen" would eat exactly the space the preview cap is saving.
 */
function ActivityTimeline({ contactId, contactEmail, lang }: { contactId: string; contactEmail: string; lang: 'nl' | 'en' }) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [groups, setGroups] = useState<ActivityGroups | null>(null)
  const [open, setOpen] = useState(false)
  // Lifted out of the group so all five can be persisted as one preference.
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsedActivity())

  function toggleGroup(kind: ActivityKind) {
    setCollapsed(prev => {
      const next = prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
      saveCollapsedActivity(next)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    fetchContactActivity(contactId, contactEmail).then(g => { if (!cancelled) setGroups(g) })
    return () => { cancelled = true }
  }, [contactId, contactEmail])

  // Substituting an empty set rather than narrowing: TypeScript will not
  // reliably carry a `groups !== null` check into the callbacks below.
  const g: ActivityGroups = groups ?? { email: [], call: [], note: [], meeting: [], marketing: [] }
  const total = ACTIVITY_GROUPS.reduce((n, def) => n + Math.min(g[def.kind].length, ACTIVITY_CAP), 0)
  const anyTruncated = ACTIVITY_GROUPS.some(def => g[def.kind].length > ACTIVITY_CAP)
  const filled = ACTIVITY_GROUPS.filter(def => g[def.kind].length > 0)

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="sl2">{t('activityTitle')}</div>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>
          {groups === null ? '…' : `(${total}${anyTruncated ? '+' : ''})`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && groups !== null && total === 0 && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('activityNone')}</div>
      )}

      {open && groups !== null && filled.map(def => (
        <ActivityGroup
          key={def.kind}
          def={def}
          items={g[def.kind]}
          lang={lang}
          collapsed={collapsed.includes(def.kind)}
          onToggle={() => toggleGroup(def.kind)}
        />
      ))}
    </div>
  )
}
/**
 * PostNL Adrescheck outcome, shown next to the address heading.
 *
 * Red means the address itself is wrong and the rep should fix it. Error is
 * grey on purpose: the check failed, which is not something the rep can act on,
 * and colouring it red would send them hunting for a problem in the address.
 *
 * Keyed lowercase so a difference in casing between HubSpot and this map cannot
 * silently blank the badge.
 */
const ADDRESS_CHECK_STATES: Record<string, { color: string; key: string }> = {
  'matched':      { color: 'var(--gr)', key: 'addrCheckMatched' },
  'needs review': { color: 'var(--or)', key: 'addrCheckReview' },
  'no match':     { color: 'var(--rd)', key: 'addrCheckNoMatch' },
  'error':        { color: 'var(--gm)', key: 'addrCheckError' },
}

/** PostNL's public address lookup — where reps go to check an address by hand. */
const POSTNL_LOOKUP_URL = 'https://www.postnl.nl/adres-zoeken/'

function AddressCheckBadge({ status, lang }: { status: string; lang: 'nl' | 'en' }) {
  const value = (status || '').trim()
  // Before the check has run there is nothing worth saying.
  if (!value) return null
  const state = ADDRESS_CHECK_STATES[value.toLowerCase()]
  // An unmapped value renders raw rather than disappearing, so a new HubSpot
  // option shows up as something odd instead of as nothing at all.
  const label = `${translate(lang, 'addrCheckPrefix')} ${state ? translate(lang, state.key) : value}`

  const dot = (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: state?.color ?? 'var(--gm)',
    }} />
  )
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: 'var(--cs)', whiteSpace: 'nowrap',
  }

  // A clean match needs no action. Every other state — including an unmapped
  // one — links out so the rep can verify the address themselves mid-call.
  if (state?.key === 'addrCheckMatched') {
    return <span style={base} title={`PostNL Adrescheck: ${value}`}>{dot}{label}</span>
  }
  return (
    <a
      href={POSTNL_LOOKUP_URL}
      target="_blank"
      rel="noreferrer"
      title={`PostNL Adrescheck: ${value} — ${translate(lang, 'addrCheckLookup')}`}
      style={{ ...base, textDecoration: 'underline' }}
    >
      {dot}{label} ↗
    </a>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Red line under a field whose input was refused. */
function FieldError({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--rd)', paddingLeft: 93 }}>{children}</div>
}

function EditableField({ label, value, onSave, highlight = false, disabled = false, inputType = 'text', validate }: {
  label: string; value: string; onSave: (v: string) => Promise<void>; highlight?: boolean; disabled?: boolean
  inputType?: string
  /** Returns why the input is refused; the field stays open until it's fixed or Esc'd. */
  validate?: (v: string) => string | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  // Enter and the blur that follows must not both save
  const savingRef = useRef(false)

  async function save() {
    if (savingRef.current) return
    const trimmed = draft.trim()
    if (trimmed === value) { setEditing(false); setError(null); return }
    const problem = validate?.(trimmed)
    if (problem) { setError(problem); return }
    setError(null)
    savingRef.current = true
    setSaving(true)
    try { await onSave(trimmed) } finally { savingRef.current = false; setSaving(false); setEditing(false) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { setDraft(value); setEditing(false); setError(null) }
  }

  return (
    <>
    <div
      className="kv"
      style={{
        alignItems: 'center',
        // Highlighted when this field is blocking a home visit — draws the eye
        // straight to what needs filling in, rather than relying on the toast.
        ...(highlight ? {
          background: 'rgba(247,102,34,0.10)',
          border: '1px solid var(--or)',
          borderRadius: 6,
          padding: '2px 6px',
          margin: '-2px -6px',
        } : {}),
      }}
    >
      <span className="kk" style={{ flexShrink: 0 }}>{label}</span>
      {editing && !disabled ? (
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null) }}
          onBlur={save}
          onKeyDown={onKeyDown}
          disabled={saving}
          style={{ ...FIELD_INPUT_STYLE, flex: 1, borderColor: error ? 'var(--rd)' : 'var(--cp)' }}
        />
      ) : (
        <FieldValue value={value} disabled={disabled} onEdit={() => setEditing(true)} />
      )}
    </div>
    {editing && error && <FieldError>{error}</FieldError>}
    </>
  )
}

const FIELD_INPUT_STYLE: React.CSSProperties = {
  fontSize: 12, padding: '2px 6px', borderRadius: 5,
  border: '1px solid var(--cp)', background: 'var(--bg)', color: 'var(--tx)',
  outline: 'none', minWidth: 0,
}

/** A field's value when not editing: click to edit, ✎ shows that you can. */
function FieldValue({ value, disabled, onEdit }: { value: string; disabled: boolean; onEdit: () => void }) {
  return (
    <span
      className="vv"
      title={disabled ? undefined : 'Click to edit'}
      onClick={() => { if (!disabled) onEdit() }}
      style={{ cursor: disabled ? 'default' : 'text', flex: 1 }}
    >
      {value || <span style={{ color: 'var(--cs)', fontStyle: 'italic' }}>--</span>}
      {!disabled && (
        <>
          {' '}
          <span style={{ fontSize: 10, color: 'var(--cs)', opacity: 0.7 }}>✎</span>
        </>
      )}
    </span>
  )
}

/**
 * Phone number with a country picker. The number is saved in E.164 (+31…);
 * the picker only matters when the rep types it the national way (06…).
 * Saves on Enter or when focus leaves both the picker and the input.
 */
function PhoneField({ label, value, onSave, disabled = false, lang }: {
  label: string; value: string; onSave: (v: string) => Promise<void>; disabled?: boolean; lang: 'nl' | 'en'
}) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [country, setCountry] = useState<PhoneCountry>(phoneCountryOf(value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // All countries load with the phone library when editing starts; until then
  // the picker offers the top countries only.
  const [countries, setCountries] = useState<{ top: PhoneCountryOption[]; rest: PhoneCountryOption[] }>(
    { top: PHONE_COUNTRIES_TOP.map(c => ({ ...c, name: c.code })), rest: [] })
  const pickedRef = useRef(false)  // the rep chose a country: don't overwrite it with the detected one

  useEffect(() => { setDraft(value); setCountry(phoneCountryOf(value)) }, [value])
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    pickedRef.current = false
    let stale = false
    loadPhoneCountries(lang).then(l => { if (!stale) setCountries(l) }).catch(() => { /* top countries still work */ })
    detectPhoneCountry(value).then(c => { if (!stale && !pickedRef.current) setCountry(c) }).catch(() => {})
    return () => { stale = true }
  }, [editing])

  const countryDial = [...countries.top, ...countries.rest].find(c => c.code === country)?.dial

  function cancel() { setDraft(value); setCountry(phoneCountryOf(value)); setEditing(false); setError(null) }

  // Enter and the blur that follows must not both save
  const savingRef = useRef(false)

  async function save() {
    if (savingRef.current) return
    const typed = draft.trim()
    if (typed === value) { setEditing(false); setError(null); return }
    if (!typed) { setError(t('phoneRequired')); return }
    savingRef.current = true
    setSaving(true)
    try {
      const e164 = await normalizePhone(typed, country)
      if (!e164) { setError(t('phoneInvalid')); return }
      setError(null)
      if (e164 !== value) await onSave(e164)
      setDraft(e164)
      setEditing(false)
    } finally { savingRef.current = false; setSaving(false) }
  }

  if (!editing || disabled) {
    return (
      <div className="kv" style={{ alignItems: 'center' }}>
        <span className="kk" style={{ flexShrink: 0 }}>{label}</span>
        <FieldValue value={value} disabled={disabled} onEdit={() => setEditing(true)} />
      </div>
    )
  }

  return (
    <>
      <div
        className="kv"
        style={{ alignItems: 'center' }}
        // Moving from the picker to the input (or back) is still editing
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save() }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') cancel()
        }}
      >
        <span className="kk" style={{ flexShrink: 0 }}>{label}</span>
        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
          {/* Shows just "NL +31" so the row stays narrow; the list itself has
              full country names, and typing a name's first letters jumps to it. */}
          <span style={{ ...FIELD_INPUT_STYLE, position: 'relative', flexShrink: 0, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            {country}{countryDial ? ` +${countryDial}` : ''} ▾
            <select
              value={country}
              onChange={e => { pickedRef.current = true; setCountry(e.target.value as PhoneCountry); setError(null) }}
              disabled={saving}
              aria-label={t('phoneCountry')}
              style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer' }}
            >
              {countries.top.map(c => <option key={c.code} value={c.code}>{c.name} +{c.dial}</option>)}
              {countries.rest.length > 0 && <option disabled>──────────</option>}
              {countries.rest.map(c => <option key={c.code} value={c.code}>{c.name} +{c.dial}</option>)}
            </select>
          </span>
          <input
            ref={inputRef}
            type="tel"
            value={draft}
            placeholder={country === 'NL' ? '06 12345678' : ''}
            onChange={e => { setDraft(e.target.value); setError(null) }}
            disabled={saving}
            style={{ ...FIELD_INPUT_STYLE, flex: 1, borderColor: error ? 'var(--rd)' : 'var(--cp)' }}
          />
        </div>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </>
  )
}

// ── Notepad flush helper ─────────────────────────────────────────────────────
// Collects all notepad values stored in pbState.notes (keyed `q.id + '_np'`)
// across every phase of every playbook, formats them as a timestamped block,
// and appends the block to personal_info__notes_lead in HubSpot.
// Called from every path that finalises a call (outcome dropdown, Book
// Appointment, Move to LTO, Move to Lost).
async function collectAndSaveNotepads(
  dealId: string,
  deal: Deal,
  playbooks: Playbook[],
  pbState: PlaybookState,
  leads: Deal[],
  patchLeadLocal: (id: string, props: Record<string, string>) => void,
): Promise<void> {
  const pbDefs = getPlaybookDefs(deal, playbooks.length > 0 ? playbooks : undefined)
  const lines: string[] = []
  for (const { def } of pbDefs) {
    for (const phase of def.phases) {
      for (const q of phase.questions) {
        const val = (pbState.notes[q.id + '_np'] || '').trim()
        if (val) lines.push(`${q.label || q.id}: ${val}`)
      }
    }
  }
  if (lines.length === 0) return

  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ts = `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`
  const block = `--- ${ts} ---\n${lines.join('\n')}`

  const current = (deal?.properties?.['personal_info__notes_lead'] || '').trim()
  const updated = current ? `${current}\n\n${block}` : block

  await patchLeadApi(dealId, { personal_info__notes_lead: updated }, leads, () => {
    patchLeadLocal(dealId, { personal_info__notes_lead: updated })
  })
  patchLeadLocal(dealId, { personal_info__notes_lead: updated })
}

// ── Long Term Opportunity modal ───────────────────────────────────────────────
// LTO was previously just Lost with the reason picked from the dropdown, which
// captured no follow-up date and left nothing to bring the lead back. This sets
// the date and reason the reactivation workflow needs, and forces a task so the
// rep has something in their own list — a Lost lead is invisible to them.
// HubSpot enforces a 10-character minimum on long_term_opportunity_reason_lead.
const LTO_REASON_MIN = 10

function LtoModal({ deal, lang }: { deal: Deal; lang: 'nl' | 'en' }) {
  const { state, setState, getPbState, patchLeadLocal } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const leadName = deal.properties?.hs_lead_name || ''

  // Local date parts, not toISOString() — that converts to UTC and can report
  // yesterday for anyone east of Greenwich.
  function todayStr(): string {
    const d = new Date()
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  function plusMonths(n: number): string {
    const d = new Date()
    d.setMonth(d.getMonth() + n)
    // Local, not toISOString(): that converts to UTC and can land on the
    // previous day for anyone east of Greenwich.
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const [date, setDate] = useState(plusMonths(1))
  const [preset, setPreset] = useState<'1m' | '2m' | 'custom'>('1m')
  const [reason, setReason] = useState('')
  const [taskTitle, setTaskTitle] = useState(t('ltoTaskTitle', leadName))
  const [saving, setSaving] = useState(false)

  function pick(p: '1m' | '2m' | 'custom') {
    setPreset(p)
    if (p === '1m') setDate(plusMonths(1))
    if (p === '2m') setDate(plusMonths(2))
  }

  async function confirm() {
    if (!date) { showToast(t('ltoNeedDate'), 'error'); return }
    // A follow-up in the past is meaningless: the reactivation workflow fires
    // when the date is a day away, so a past date would never bring the lead
    // back at all.
    if (date < todayStr()) { showToast(t('ltoDatePast'), 'error', 6000); return }
    // long_term_opportunity_reason_lead has a 10-character minimum in HubSpot.
    // Checked here so the rep is told before anything is written, rather than
    // getting a 400 after the task has already been created.
    if (reason.trim().length < LTO_REASON_MIN) { showToast(t('ltoReasonShort', LTO_REASON_MIN), 'error', 6000); return }
    if (!taskTitle.trim()) { showToast(t('ltoNeedTask'), 'error'); return }

    setSaving(true)
    try {
      // Task first, deliberately. The lead only moves to Lost once there is
      // something to bring it back — if this fails, the lead stays workable
      // rather than disappearing with no follow-up attached.
      const taskId = await createHsTask(
        taskTitle.trim(),
        reason.trim(),
        date,
        state.currentRep?.hubspotOwnerId || '',
        deal.id,
      )
      if (!taskId) throw new Error(t('ltoTaskFailed'))

      try {
        await patchLeadApi(deal.id, {
          hs_pipeline_stage: CONFIG.STAGES.LTO,
          [CONFIG.PROPS.callResult]: 'Long Term Opportunity',
          long_term_opportunity_followup_date_lead: date,
          long_term_opportunity_reason_lead: reason.trim(),
        }, state.leads, leads => setState({ leads }))
        // Flush notepads to personal_info__notes_lead before the lead disappears
        const pbState = getPbState(deal.id)
        await collectAndSaveNotepads(deal.id, deal, state.playbooks, pbState, state.leads, patchLeadLocal)
          .catch(() => { /* best effort */ })
      } catch (patchErr) {
        // The task was created first so the lead is never parked without a
        // follow-up. If the patch then fails, that task is an orphan — remove
        // it rather than leaving one behind on every failed attempt.
        try { await deleteHsTask(taskId) } catch { /* best effort */ }
        throw patchErr
      }

      setState({ leads: state.leads.filter(l => l.id !== deal.id), selectedId: null, modal: null })
      showToast(t('ltoSaved'), 'success')
    } catch (e: any) {
      showToast(e.message || 'Error', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) setState({ modal: null }) }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{t('ltoTitle')}</div>
          <button className="xb" onClick={() => setState({ modal: null })}>✕</button>
        </div>
        <div className="mob">
          <div className="iw">
            <label className="il">{t('ltoWhen')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <div className="cr2" style={{ marginBottom: 6 }}>
              <button className={`chip ${preset === '1m' ? 'on' : ''}`} onClick={() => pick('1m')}>{t('lto1m')}</button>
              <button className={`chip ${preset === '2m' ? 'on' : ''}`} onClick={() => pick('2m')}>{t('lto2m')}</button>
              <button className={`chip ${preset === 'custom' ? 'on' : ''}`} onClick={() => pick('custom')}>{t('ltoCustom')}</button>
            </div>
            <input
              className="inp"
              type="date"
              min={todayStr()}
              value={date}
              onChange={e => { setDate(e.target.value); setPreset('custom') }}
            />
          </div>

          <div className="iw">
            <label className="il">{t('ltoReason')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <textarea
              className="inp"
              rows={3}
              placeholder={t('ltoReasonPh')}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            <div style={{ fontSize: 11, color: reason.trim().length < LTO_REASON_MIN ? 'var(--or)' : 'var(--cs)', marginTop: 4 }}>
              {t('ltoReasonCount', reason.trim().length, LTO_REASON_MIN)}
            </div>
          </div>

          <div className="iw">
            <label className="il">{t('ltoTask')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <input className="inp" type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--cs)', marginTop: 4 }}>{t('ltoTaskHint')}</div>
          </div>
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-md" onClick={() => setState({ modal: null })}>{t('cancel')}</button>
          <button className="btn btn-pr btn-md" disabled={saving || !date} onClick={confirm}>
            {saving ? t('ltoSaving') : t('ltoConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Result of the "direct appointment already booked" check on a partner lead
 * (see fetchDirectAppointmentDeals). `partner` is the lead's partner name, so
 * the copy can say "VEH" or whichever partner is configured.
 */
type DirectCheck =
  | { status: 'off' }
  | { status: 'loading' | 'error'; partner: string }
  | { status: 'done'; partner: string; deals: DirectDeal[] }

function LostModal({ dealId, lang, directCheck }: { dealId: string; lang: 'nl' | 'en'; directCheck: DirectCheck }) {
  const { state, setState, getPbState, patchLeadLocal } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([])
  const [selected, setSelected] = useState<string>('')
  // A partner lead whose customer already booked directly: Lost needs an
  // explicit confirmation that the customer doesn't want the partner offer.
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const hasDirect = directCheck.status === 'done' && directCheck.deals.length > 0
  const checking = directCheck.status === 'loading'
  const partner = directCheck.status === 'off' ? '' : directCheck.partner

  useEffect(() => {
    fetchLeadPropertyOptions(CONFIG.PROPS.lostReasons).then(all => {
      // Long Term Opportunity has its own button, so it's not offered as a Lost reason
      const opts = all.filter(o => o.label.trim().toLowerCase() !== 'long term opportunity')
      if (opts.length > 0) {
        setOptions(opts)
      } else {
        setOptions(translateArr(lang, 'lostReasons').map(o => ({ label: o, value: o })))
      }
    })
  }, [])

  async function confirmLost() {
    if (!selected) { showToast(t('errReason'), 'error'); return }
    if (checking) { showToast(t('directDealChecking'), 'error'); return }
    if (hasDirect && !cancelConfirmed) { showToast(t('directDealTickRequired', partner), 'error'); return }
    try {
      await patchLeadApi(dealId, {
        hs_pipeline_stage: CONFIG.STAGES.LOST,
        [CONFIG.PROPS.lostReasons]: selected,
        [CONFIG.PROPS.callResult]: 'Lost',
      }, state.leads, leads => setState({ leads }))
      // Flush notepads before the lead is removed from local state
      const deal = state.leads.find(l => l.id === dealId)
      if (deal) {
        const pbState = getPbState(dealId)
        await collectAndSaveNotepads(dealId, deal, state.playbooks, pbState, state.leads, patchLeadLocal)
          .catch(() => { /* best effort */ })
      }
      setState({ leads: state.leads.filter(l => l.id !== dealId), selectedId: null, modal: null })
      showToast(t('toastLost'), 'success')
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) setState({ modal: null }) }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{t('lostTitle')}</div>
          <button className="xb" onClick={() => setState({ modal: null })}>✕</button>
        </div>
        <div className="mob">
          {hasDirect && (
            <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, background: 'rgba(247,102,34,0.10)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)', marginBottom: 4 }}>⚠ {t('directDealTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--ct)' }}>{t('directDealLostWarn', partner)}</div>
            </div>
          )}
          {checking && (
            <div style={{ fontSize: 12, color: 'var(--cs)', marginBottom: 12 }}>{t('directDealChecking')}</div>
          )}
          {directCheck.status === 'error' && (
            <div style={{ fontSize: 12, color: 'var(--cs)', marginBottom: 12 }}>{t('directDealCheckFailed')}</div>
          )}
          <div className="iw">
            <label className="il">{t('lostReason')} <span style={{ color: 'var(--rd)' }}>*</span></label>
            <select className="sel" value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">--</option>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {hasDirect && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--ct)', cursor: 'pointer' }}>
              <input type="checkbox" className="chk" checked={cancelConfirmed} onChange={e => setCancelConfirmed(e.target.checked)} />
              <span>{t('directDealTick', partner)} <span style={{ color: 'var(--rd)' }}>*</span></span>
            </label>
          )}
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={() => setState({ modal: null })}>{t('cancel')}</button>
          <button className="btn btn-dn btn-sm" onClick={confirmLost} disabled={!selected || checking || (hasDirect && !cancelConfirmed)}>
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SchedModal({ deal, lang, onBooked }: { deal: Deal; lang: 'nl' | 'en'; onBooked: () => void }) {
  const { state, setState } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const sched = getScheduler(deal, state.schedulers)
  const [confirming, setConfirming] = useState(false)

  // Prefill the scheduler with the customer's details so the rep doesn't have
  // to type them while on the phone. Fetched on open rather than upfront — only
  // one lead is ever being scheduled at a time.
  const [contact, setContact] = useState<Awaited<ReturnType<typeof fetchLeadContact>>>(null)
  const [loadingContact, setLoadingContact] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchLeadContact(deal.id)
      .then(c => { if (!cancelled) setContact(c) })
      .finally(() => { if (!cancelled) setLoadingContact(false) })
    return () => { cancelled = true }
  }, [deal.id])

  const schedUrl = sched ? buildSchedulerUrl(sched.url, contact) : ''

  // HubSpot's meetings iframe posts a message to the parent window when a
  // booking succeeds. Listening for it sets the call result at the moment the
  // appointment is actually made, instead of relying on the rep answering the
  // "Afspraak gemaakt?" prompt afterwards.
  //
  // The manual prompt is kept as a fallback: a rep who books via "Open planner"
  // (new tab) is outside this window, so no message reaches us there.
  useEffect(() => {
    if (!sched) return
    let expectedOrigin = ''
    try { expectedOrigin = new URL(sched.url).origin } catch { /* malformed URL configured in Admin */ }

    function onMessage(e: MessageEvent) {
      // Only trust messages from the scheduler's own origin.
      if (expectedOrigin && e.origin !== expectedOrigin) return
      if (!e.data || typeof e.data !== 'object') return
      if ((e.data as { meetingBookSucceeded?: boolean }).meetingBookSucceeded !== true) return
      onBooked()
      setState({ modal: null })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sched?.url, onBooked, setState])

  function handleClose() {
    setConfirming(true)
  }

  function handleBooked(yes: boolean) {
    setConfirming(false)
    if (yes) onBooked()
    setState({ modal: null })
  }

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="mo">
        <div className="moh">
          <div className="mot">{sched?.name || t('schedTitle')}</div>
          <button className="xb" onClick={handleClose}>✕</button>
        </div>
        <div className="mob">
          {!sched
            ? <div className="wb">⚙️ {t('noSchedCfg')}</div>
            : (
              <>
                {/* HubSpot's meetings form matches contacts on email: a changed
                    email there books onto a new, duplicate contact. */}
                <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '6px 10px', marginBottom: 10, background: 'rgba(247,102,34,0.10)', fontSize: 12, color: 'var(--ct)' }}>
                  ⚠ {t('schedEmailHint')}
                </div>
                <a href={schedUrl} target="_blank" rel="noreferrer" className="btn btn-pr btn-md btn-full" style={{ textDecoration: 'none' }}>
                  {t('openSched')}
                </a>
                {/* Wait for the contact fetch before rendering the iframe — the
                    scheduler reads its prefill params on load, so mounting it
                    early would show empty fields and never refill them. */}
                {loadingContact
                  ? <div className="wb" style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>…</div>
                  : <iframe src={schedUrl} style={{ width: '100%', height: 360, border: 'none', borderRadius: 10, outline: '1px solid var(--gl)' }} />
                }
              </>
            )
          }
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={handleClose}>{t('close')}</button>
        </div>
      </div>
      {/* Booking confirmation overlay */}
      {confirming && (
        <div className="mb" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
          <div className="mo" style={{ maxWidth: 380 }}>
            <div className="moh">
              <div className="mot">{t('schedBooked')}</div>
            </div>
            <div className="mob" style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ marginBottom: 16, color: 'var(--tx)' }}>{t('schedBookedQ')}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-gn btn-sm" onClick={() => handleBooked(true)}>{t('yes')}</button>
                <button className="btn btn-sc btn-sm" onClick={() => handleBooked(false)}>{t('no')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CallOutcome section ───────────────────────────────────────────────────────
function CallOutcomeSection({ dealId, lang, disabled = false }: { dealId: string; lang: 'nl' | 'en'; disabled?: boolean }) {
  const { state, getPbState, setCallOutcome, setCallOutcomeNote, patchLeadLocal } = useApp()
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const pbSt = getPbState(dealId)
  const deal = state.leads.find(l => l.id === dealId)
  const savedOutcome = deal?.properties?.[CONFIG.PROPS.callOutcome]
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    fetchLeadPropertyOptions(CONFIG.PROPS.callOutcome).then(opts => {
      if (opts.length > 0) {
        setOptions(opts)
      } else {
        setOptions(translateArr(lang, 'callOutcomes').map(o => ({ label: o, value: o })))
      }
    })
  }, [])

  async function handleChange(value: string) {
    setCallOutcome(dealId, value)
    if (!value) return
    try {
      await patchLeadApi(dealId, { [CONFIG.PROPS.callOutcome]: value }, state.leads, leads => {
        patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: value })
      })
      patchLeadLocal(dealId, { [CONFIG.PROPS.callOutcome]: value })
      showToast(t('toastSaved'), 'success')
      // Flush all notepad values to personal_info__notes_lead now that the
      // call has an outcome — silently, the rep already got a toast above.
      if (deal) {
        const pbState = getPbState(dealId)
        collectAndSaveNotepads(dealId, deal, state.playbooks, pbState, state.leads, patchLeadLocal)
          .catch(() => { /* best effort — notepad flush should not block the outcome save */ })
      }
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="sl2">{lang === 'nl' ? 'Call outcome' : 'Call outcome'}</div>
      <select
        className="inp"
        value={pbSt.callOutcome || savedOutcome || ''}
        onChange={e => handleChange(e.target.value)}
        disabled={disabled}
        style={{ width: '100%' }}
      >
        <option value="">{lang === 'nl' ? '-- Selecteer uitkomst --' : '-- Select outcome --'}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── DealModal ─────────────────────────────────────────────────────────────────
export default function DealModal() {
  const { state, setState, selectLead, patchLeadLocal, getPbState } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ type: 'move' | 'resize'; sx: number; sy: number; sw: number; sh: number; sl: number; st: number } | null>(null)

  // ── Drag / resize — must be before the early return to avoid hooks-order violation ──
  const startDrag = useCallback((e: React.MouseEvent, type: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    const card = cardRef.current
    if (!card) return
    const r = card.getBoundingClientRect()
    dragRef.current = { type, sx: e.clientX, sy: e.clientY, sw: r.width, sh: r.height, sl: r.left, st: r.top }
    // Commit current position to state for pixel-accurate dragging
    setState({ dmX: r.left, dmY: r.top, dmW: r.width, dmH: r.height })
    card.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;max-width:none;max-height:none;`

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      me.preventDefault()
      const dx = me.clientX - dragRef.current.sx
      const dy = me.clientY - dragRef.current.sy
      const c = cardRef.current
      if (!c) return
      const vw = window.innerWidth, vh = window.innerHeight
      if (dragRef.current.type === 'move') {
        const nx = Math.max(0, Math.min(dragRef.current.sl + dx, vw - 120))
        const ny = Math.max(0, Math.min(dragRef.current.st + dy, vh - 60))
        c.style.left = nx + 'px'; c.style.top = ny + 'px'
      } else {
        const nw = Math.max(420, Math.min(dragRef.current.sw + dx, vw))
        const nh = Math.max(300, Math.min(dragRef.current.sh + dy, vh))
        c.style.width = nw + 'px'; c.style.height = nh + 'px'
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove, { passive: false })
    document.addEventListener('mouseup', onUp)
  }, [setState])

  // Address fields currently blocking a home visit — highlighted inline so the
  // rep can see exactly what to fill without hunting for it.
  // Declared here with the other hooks: must be above the early return below,
  // or React's hook order breaks when no deal is selected.
  const [hvMissing, setHvMissing] = useState<string[]>([])

  // Partner leads (VEH) whose customer may already have booked directly with
  // Quatt: checked once when the lead opens. Drives the banner below and the
  // extra confirmation in the Lost popup. Skipped once the lead is SQL — by
  // then the partner deal exists and the customer can compare prices.
  const selLead = state.leads.find(l => l.id === state.selectedId)
  const selPartner = String(selLead?.properties?.[CONFIG.PROPS.partner] || '').trim()
  const checkPartner = selLead
    && selLead.properties.hs_pipeline_stage !== CONFIG.STAGES.SQL
    && CONFIG.DIRECT_DEAL_CHECK_PARTNERS.some(x => x.toLowerCase() === selPartner.toLowerCase())
    ? selPartner : ''
  const checkContactId = String(selLead?.properties?.hs_primary_contact_id || '')
  const [directCheck, setDirectCheck] = useState<DirectCheck>({ status: 'off' })
  useEffect(() => {
    const leadId = state.selectedId
    if (!leadId || !checkPartner) { setDirectCheck({ status: 'off' }); return }
    let stale = false
    setDirectCheck({ status: 'loading', partner: checkPartner })
    fetchDirectAppointmentDeals(leadId, checkContactId || undefined)
      .then(deals => { if (!stale) setDirectCheck({ status: 'done', partner: checkPartner, deals }) })
      .catch(e => {
        console.error('[hs] direct deal check failed:', leadId, e)
        if (!stale) setDirectCheck({ status: 'error', partner: checkPartner })
      })
    return () => { stale = true }
  }, [state.selectedId, checkPartner, checkContactId])

  // The contact's own email and phone, editable under Lead info. Read live
  // because the lead's synced copies can lag behind. emailTaken holds the id of another
  // contact that already has the email the rep tried to save.
  const [contact, setContact] = useState<{ status: 'off' | 'loading' | 'done' | 'error' } & ContactDetails>(
    { status: 'off', email: '', phone: '' })
  const [emailTaken, setEmailTaken] = useState<string | null>(null)  // '' = taken, id unknown
  useEffect(() => {
    setEmailTaken(null)
    if (!checkContactId) { setContact({ status: 'off', email: '', phone: '' }); return }
    let stale = false
    setContact({ status: 'loading', email: '', phone: '' })
    fetchContactDetails(checkContactId)
      .then(c => { if (!stale) setContact({ status: 'done', ...c }) })
      .catch(e => {
        console.error('[hs] contact details failed:', checkContactId, e)
        if (!stale) setContact({ status: 'error', email: '', phone: '' })
      })
    return () => { stale = true }
  }, [checkContactId])

  // ── Deal-specific setup (after hooks) ──────────────────────────────────────
  const deal = selLead
  if (!deal) return null

  // Capture id so closures below don't re-evaluate the possibly-undefined find result
  const dealId = deal.id
  const p = deal.properties
  const P = CONFIG.PROPS
  const pbDefs = getPlaybookDefs(deal, state.playbooks.length > 0 ? state.playbooks : undefined)

  function closeDeal() {
    selectLead(null)
    setState({ dmX: null, dmY: null, dmW: null, dmH: null })
  }

  function openLost() {
    // Belt-and-suspenders: the button is already disabled once a lead reaches
    // SQL, but guard here too in case this is ever called from somewhere else.
    if (p.hs_pipeline_stage === CONFIG.STAGES.SQL) {
      showToast(t('sqlLockedNote'), 'error')
      return
    }
    setState({ modal: 'lost', modalDealId: dealId })
  }

  function openLto() {
    // Same guard as openLost()/openSched() above.
    if (p.hs_pipeline_stage === CONFIG.STAGES.SQL) {
      showToast(t('sqlLockedNote'), 'error')
      return
    }
    setState({ modal: 'lto', modalDealId: dealId })
  }

  // Admin-only recovery for leads accidentally moved to Lost. Clears the
  // properties the Lost flow sets so the lead re-enters MQL exactly as if it
  // had never been closed, rather than carrying stale call-result/outcome data.
  async function restoreFromLost() {
    if (!confirm(t('restoreFromLostConfirm'))) return
    try {
      await patchLeadApi(dealId, {
        hs_pipeline_stage: CONFIG.STAGES.MQL,
        [CONFIG.PROPS.callResult]: '',
        [CONFIG.PROPS.lostReasons]: '',
        [CONFIG.PROPS.callOutcome]: '',
      }, state.leads, leads => setState({ leads }))
      showToast(t('toastRestored'), 'success')
      closeDeal()
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
    }
  }

  function openSched() {
    // Belt-and-suspenders: the button is already disabled once a lead reaches
    // SQL, but guard here too in case this is ever called from somewhere else.
    if (p.hs_pipeline_stage === CONFIG.STAGES.SQL) {
      showToast(t('sqlLockedNote'), 'error')
      return
    }
    setState({ modal: 'sched', modalDealId: dealId })
  }

  function openCreateTask() {
    setState({
      taskModal: 'create',
      taskDraft: { dealId: dealId, assigneeEmail: state.currentRep?.email || '', title: '', dueDate: '', note: '' },
    })
  }

  async function handleCallResult(value: string) {
    // Once a lead reaches SQL, HubSpot converts it into a deal — the lead
    // record is done and no booking action should write to it anymore.
    // The buttons that reach this are already disabled; this guard covers
    // any other path that might call it (e.g. the scheduler's onBooked).
    if (p.hs_pipeline_stage === CONFIG.STAGES.SQL) {
      showToast(t('sqlLockedNote'), 'error')
      return
    }
    // Plan HV needs a resolvable address: the home-visit scheduler can't produce
    // a URL without one. Postcode + house number are the required pair — PostNL
    // Adrescheck backfills street and city from those two. House number suffix
    // stays optional (many addresses don't have one, though it's often needed in
    // NL to pin down the exact address — reps can add it inline above).
    //
    // Guarding here matters because Plan HV is not a reversible click: it writes
    // the call result, which moves the lead to SQL and creates a deal. Without an
    // address the rep then waits ~3 minutes on a polling overlay and ends up with
    // a converted lead and no home visit booked.
    if (value === 'Plan HV') {
      // Belt-and-suspenders: the button is already disabled for Chill-only leads,
      // but guard here too in case this is ever called from somewhere else.
      if (String(p[P.product] || '').trim().toLowerCase() === 'chill') {
        showToast(t('homeVisitChillDisabled'), 'error')
        return
      }
      const missingProps: string[] = []
      const missingLabels: string[] = []
      if (!String(p['postal_code'] || '').trim())  { missingProps.push('postal_code');  missingLabels.push(t('postalCode')) }
      if (!String(p['house_number'] || '').trim()) { missingProps.push('house_number'); missingLabels.push(t('houseNumber')) }
      if (missingProps.length > 0) {
        // Always flag the suffix too — it's optional to fill, but address quality
        // decides whether job creation passes verification in the backend later.
        setHvMissing([...missingProps, 'house_number_suffix'])
        showToast(t('hvAddressRequired', missingLabels.join(', ')), 'error', 9000)
        return
      }
      setHvMissing([])
    }

    const needsDeal = value === 'Plan HV' || value === 'Plan Call'
    if (needsDeal) {
      // Show loading overlay immediately — global state so it survives DealModal unmounting
      setState({ dealLoading: true, dealNotif: null })
    }
    try {
      await patchLeadApi(dealId, { [CONFIG.PROPS.callResult]: value }, state.leads, leads => setState({ leads }))
      patchLeadLocal(dealId, { [CONFIG.PROPS.callResult]: value })
      // Flush notepad notes to personal_info__notes_lead now that the call is finalized
      if (deal) {
        const pbState = getPbState(dealId)
        collectAndSaveNotepads(dealId, deal, state.playbooks, pbState, state.leads, patchLeadLocal)
          .catch(() => { /* best effort */ })
      }
      if (needsDeal) {
        // Poll for associated deal — HubSpot creates it ~30s after lead moves to SQL
        const capturedLang = lang
        const MAX_ATTEMPTS = 24   // 24 × 5s = 120s total
        const INTERVAL_MS = 5000
        let attempts = 0
        const poll = async (): Promise<void> => {
          attempts++
          const found = await fetchAssociatedDeal(dealId)
          if (found) {
            if (value === 'Plan HV') {
              // Show banner immediately; poll separately for HV URL (~20s to populate)
              setState({
                dealLoading: false,
                dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: found.hvSchedulerUrl, hvSchedulerLoading: !found.hvSchedulerUrl },
              })
              if (!found.hvSchedulerUrl) {
                let hvAttempts = 0
                const HV_URL_MAX = 12 // 12 × 5s = 60s
                const pollHvUrl = async (): Promise<void> => {
                  hvAttempts++
                  const updated = await fetchAssociatedDeal(dealId)
                  if (updated?.hvSchedulerUrl) {
                    setState({ dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: updated.hvSchedulerUrl, hvSchedulerLoading: false } })
                    return
                  }
                  if (hvAttempts < HV_URL_MAX) {
                    setTimeout(pollHvUrl, 5000)
                  } else {
                    setState({ dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: null, hvSchedulerLoading: false } })
                  }
                }
                setTimeout(pollHvUrl, 5000)
              }
            } else {
              setState({
                dealLoading: false,
                dealNotif: { id: found.id, name: found.name, hvSchedulerUrl: null },
              })
            }
            return
          }
          if (attempts < MAX_ATTEMPTS) {
            setTimeout(poll, INTERVAL_MS)
          } else {
            setState({ dealLoading: false })
            showToast(capturedLang === 'nl' ? 'Deal nog niet beschikbaar' : 'Deal not yet available — check HubSpot shortly', 'error')
          }
        }
        poll()
      } else {
        showToast(value, 'success')
      }
    } catch (e: any) {
      setState({ dealLoading: false })
      showToast(t('errLoad', e.message), 'error')
    }
  }

  const cardStyle: React.CSSProperties = state.dmX != null
    ? { position: 'fixed', left: state.dmX, top: state.dmY!, width: state.dmW!, height: state.dmH!, maxWidth: 'none', maxHeight: 'none' }
    : {}

  const sched = getScheduler(deal, state.schedulers)
  const schedLabel = stripLeadingSymbol(sched?.buttonLabel || t('schedVC'))
  const openTasks = dealOpenTasks(deal.id)

  // Chill-only leads don't get a home visit — Chill is a self-install product.
  // Exact match on the whole property value (not a substring/includes check):
  // multi-checkbox values like "Chill;Hybrid Single" must NOT match here, only
  // a lead where Chill is the sole selection. Re-derived from `p` on every
  // render, so the button re-enables the moment the rep adds another product
  // or changes the selection via the playbook.
  const isChillOnly = String(p[P.product] || '').trim().toLowerCase() === 'chill'

  // A lead that reached SQL has converted to a HubSpot deal — the lead record
  // itself is done, so property edits and the booking actions below are
  // locked. Re-derived from `p` on every render like `isChillOnly` above.
  const isSQL = p.hs_pipeline_stage === CONFIG.STAGES.SQL

  // Until the contact has loaded (or when it can't be), show the lead's copies
  // read-only. The header and Call button follow the contact once it's in.
  const contactReady = contact.status === 'done'
  const shownEmail = contactReady ? contact.email : (p['contact_email'] || '')
  const shownPhone = contactReady ? contact.phone : (p.phone_number || '')
  const callPhone = (contactReady && contact.phone) || p.phone_number || ''

  // Email / phone are written to the contact only. The lead's contact_email /
  // phone_number are HubSpot sync properties that follow the contact by
  // themselves (and refuse direct writes); the local copy is updated so the
  // header, board and activity timeline show the new value straight away.
  async function saveContactField(field: 'email' | 'phone', value: string) {
    if (!checkContactId) return
    try {
      await patchContact(checkContactId, field === 'email' ? { email: value } : { phone: value })
    } catch (e: any) {
      if (e instanceof ContactEmailTakenError) { setEmailTaken(e.existingId); return }
      showToast(t('errLoad', e.message), 'error')
      return
    }
    if (field === 'email') setEmailTaken(null)
    setContact(c => ({ ...c, [field]: value }))
    patchLeadLocal(dealId, { [field === 'email' ? 'contact_email' : 'phone_number']: value })
    showToast(t('toastSaved'), 'success')
  }

  return (
    <>
      <div
        className="dm-overlay"
        onClick={e => { if (e.target === e.currentTarget) closeDeal() }}
      >
        <div
          ref={cardRef}
          className="dm-card pop-in"
          style={cardStyle}
        >
          {/* Header — drag handle */}
          <div className="dm-head" onMouseDown={e => startDrag(e, 'move')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dm-title" title={p.hs_lead_name || ''}>{p.hs_lead_name || '--'}</div>
                <div className="dm-sub">{p[P.product] || '--'}</div>
              </div>
              <button
                className="xb"
                style={{ flexShrink: 0, marginLeft: 10, pointerEvents: 'auto' }}
                onMouseDown={e => e.stopPropagation()}
                onClick={closeDeal}
              >✕</button>
            </div>
            <div className="dm-meta">
              <span className="dm-phone">{callPhone || '--'}</span>
              {callPhone && (
                <a
                  href={`tel:${callPhone.replace(/\s/g, '')}`}
                  className="btn btn-pr btn-sm"
                  onMouseDown={e => e.stopPropagation()}
                  style={{ pointerEvents: 'auto', textDecoration: 'none' }}
                >
                  <PillIcon name="phone" />{t('callBtn')}
                </a>
              )}
            </div>
          </div>

          {/* Body: warnings across the full width, then the lead on the left
              and the playbook on the right. Each column scrolls on its own. */}
          <div className="dm-body">
            {/* Lead already converted to a deal — properties and the booking
                buttons below are locked; this is the explanation for why. */}
            {isSQL && (
              <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, background: 'rgba(247,102,34,0.10)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)' }}>
                  {t('sqlLockedNote')}
                </div>
              </div>
            )}

            {/* Partner lead whose customer already booked directly. Reps used
                to move these to Lost ("I already have an appointment"), which
                left the customer without the partner deal they need to see the
                partner prices. */}
            {directCheck.status === 'done' && directCheck.deals.length > 0 && (
              <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, background: 'rgba(247,102,34,0.10)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)', marginBottom: 6 }}>
                  ⚠ {t('directDealTitle')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
                  {directCheck.deals.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ct)' }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--cs)' }}>
                          {t('directDealStage')}: {d.stage || '--'}
                          {d.appointmentAt && <> · {t('directDealAppt')}: {actDate(d.appointmentAt)}</>}
                        </div>
                      </div>
                      {state.hubspotPortalId && (
                        <a
                          className="btn btn-sc btn-xs"
                          href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/record/0-3/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          {t('directDealOpen')}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ct)' }}>
                  {t('directDealBody', directCheck.partner)}
                </div>
              </div>
            )}

            <div className={`dm-cols${pbDefs.length > 0 ? '' : ' solo'}`}>
              {/* Left: what we know about the lead, and how this call went */}
              <div className="dm-col">
                {/* Long Term context, written when the lead was parked.
                    Read back here because whoever is looking at it is usually not
                    whoever parked it: three days after a parked lead reactivates,
                    the workflow clears the owner so a colleague can pick it up.
                    Without this the lead arrives on their board with no trace of
                    where it has been or why. */}
                {(p['long_term_opportunity_reason_lead'] || p['long_term_opportunity_followup_date_lead']) && (
                  <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)', marginBottom: 4 }}>
                      {t('ltoCtxTitle')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {p['long_term_opportunity_followup_date_lead'] && (
                        <div className="kv">
                          <span className="kk">{t('ltoCtxDate')}</span>
                          <span className="vv">{actDate(p['long_term_opportunity_followup_date_lead'])}</span>
                        </div>
                      )}
                      {p['long_term_opportunity_reason_lead'] && (
                        <div className="kv">
                          <span className="kk">{t('ltoCtxReason')}</span>
                          <span className="vv" style={{ whiteSpace: 'normal' }}>
                            {p['long_term_opportunity_reason_lead']}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Lead info + Address side by side, stacked when the column
                    gets too narrow for both */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                  {/* Left: lead info */}
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div className="sl2">{t('leadInfo')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div className="kv"><span className="kk">{t('origin')}</span><span className="vv">{p[P.formOrigin] || '--'}</span></div>
                      <div className="kv"><span className="kk">{t('product')}</span><span className="vv">{p[P.product] || '--'}</span></div>
                      <div className="kv"><span className="kk">{t('reqAt')}</span><span className="vv">{relTime(p[P.requestedAt])}</span></div>
                      {/* Saved on the contact, not the lead — the safe place to
                          fix a wrong email instead of the scheduler form */}
                      <EditableField
                        label={t('email')}
                        value={shownEmail}
                        inputType="email"
                        disabled={isSQL || !contactReady}
                        validate={v => !v ? t('emailRequired') : EMAIL_RE.test(v) ? null : t('emailInvalid')}
                        onSave={v => saveContactField('email', v.toLowerCase())}
                      />
                      {emailTaken !== null && (
                        <FieldError>
                          {t('emailTaken')}
                          {emailTaken && state.hubspotPortalId && (
                            <>
                              {' '}
                              <a
                                href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/record/0-1/${emailTaken}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: 'var(--rd)', textDecoration: 'underline' }}
                              >
                                {t('emailTakenOpen')}
                              </a>
                            </>
                          )}
                        </FieldError>
                      )}
                      <PhoneField
                        label={t('phone')}
                        value={shownPhone}
                        lang={lang}
                        disabled={isSQL || !contactReady}
                        onSave={v => saveContactField('phone', v)}
                      />
                      {contact.status === 'error' && (
                        <div style={{ fontSize: 11, color: 'var(--cs)' }}>{t('contactLoadFailed')}</div>
                      )}
                    </div>
                  </div>
                  {/* Right: editable address */}
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div className="sl2">{t('address')}</div>
                        <AddressCheckBadge status={p['postnl_adrescheck_status'] || ''} lang={lang} />
                      </div>
                      {/* Straight to the contact in HubSpot — reps need the activity
                          history, which lives on the contact, not the lead. Uses the
                          lead's own hs_primary_contact_id so no extra lookup is needed. */}
                      {p['hs_primary_contact_id'] && state.hubspotPortalId && (
                        <a
                          className="btn btn-sc btn-xs"
                          href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/record/0-1/${p['hs_primary_contact_id']}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                        >
                          {t('openContact')}
                        </a>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {([
                        { label: t('street'),            prop: 'street_lead' },
                        { label: t('houseNumber'),       prop: 'house_number' },
                        { label: t('houseNumberSuffix'), prop: 'house_number_suffix' },
                        { label: t('postalCode'),        prop: 'postal_code' },
                        { label: t('city'),              prop: 'city' },
                      ] as Array<{ label: string; prop: string }>).map(({ label, prop }) => (
                        <EditableField
                          key={prop}
                          label={label}
                          value={p[prop] || ''}
                          highlight={hvMissing.includes(prop)}
                          disabled={isSQL}
                          onSave={async (val) => {
                            await patchLeadApi(dealId, { [prop]: val }, state.leads, leads => setState({ leads }))
                            patchLeadLocal(dealId, { [prop]: val })
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recent communication, when we know which contact the lead is.
                    Activities live on the contact, so without one there is nothing
                    to show. */}
                {p['hs_primary_contact_id'] && (
                  <>
                    <div className="dv" />
                    <ErrorBoundary fallback={
                      <div style={{ fontSize: 12, color: 'var(--cs)' }}>{t('activityFailed')}</div>
                    }>
                      <ActivityTimeline
                        contactId={p['hs_primary_contact_id']}
                        contactEmail={p['contact_email'] || ''}
                        lang={lang}
                      />
                    </ErrorBoundary>
                  </>
                )}

                <div className="dv" />

                {/* Call outcome — always visible */}
                <CallOutcomeSection dealId={deal.id} lang={lang} disabled={isSQL} />
              </div>

              {/* Right: the playbook. pbDefs is empty only when there are
                  genuinely no playbooks to show; the left column then takes
                  the full width. Leads without a product get all playbooks
                  (see getPlaybookDefs) so the rep can pick. Once the lead is SQL,
                  the whole block is visible but non-interactive — no answers or
                  notepads should keep writing to a lead that already converted. */}
              {pbDefs.length > 0 && (
                <div className="dm-col">
                  <div className="sl2">{t('pbLabel')}</div>
                  <div style={isSQL ? { pointerEvents: 'none', opacity: 0.55 } : undefined}>
                    <PlaybookView
                      dealId={deal.id}
                      pbDefs={pbDefs.map(pi => ({ key: pi.key, def: pi.def }))}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="dm-foot" style={{ position: 'relative' }}>
            <button
              className="btn btn-gn btn-sm"
              onClick={() => handleCallResult('Plan HV')}
              disabled={isChillOnly || isSQL}
              title={isSQL ? t('sqlLockedNote') : (isChillOnly ? t('homeVisitChillDisabled') : undefined)}
            ><PillIcon name="home" />{t('homeVisit')}</button>
            <button
              className="btn btn-sc btn-sm"
              onClick={openSched}
              disabled={isSQL}
              title={isSQL ? t('sqlLockedNote') : undefined}
            ><PillIcon name="video" />{schedLabel}</button>
            <button
              className="btn btn-sc btn-sm"
              onClick={openLto}
              disabled={isSQL}
              title={isSQL ? t('sqlLockedNote') : undefined}
            ><PillIcon name="calendar" />{t('ltoBtn')}</button>
            {state.isAdmin && p.hs_pipeline_stage === CONFIG.STAGES.LOST && (
              <button className="btn btn-sc btn-sm" onClick={restoreFromLost}><PillIcon name="restore" />{t('restoreFromLost')}</button>
            )}
            <button className="btn btn-sc btn-sm" onMouseDown={e => e.stopPropagation()} onClick={openCreateTask}>
              <PillIcon name="plus" />{t('taskAddFromDeal')}
              {openTasks.length > 0 && <span className="task-badge">{openTasks.length}</span>}
            </button>
            {/* Lost sits apart on the far right, away from the buttons that
                move the lead forward, so it is not hit by accident. */}
            <button
              className="btn btn-dn btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={openLost}
              disabled={isSQL}
              title={isSQL ? t('sqlLockedNote') : undefined}
            ><PillIcon name="close" />{t('markLost')}</button>
            {/* Resize grip */}
            <div className="dm-grip" onMouseDown={e => startDrag(e, 'resize')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M11 1L1 11M11 6L6 11M11 11" stroke="#081412" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Nested modals */}
      {state.modal === 'lost' && state.modalDealId === deal.id && (
        <LostModal dealId={deal.id} lang={lang} directCheck={directCheck} />
      )}
      {state.modal === 'lto' && state.modalDealId === deal.id && (
        <LtoModal deal={deal} lang={lang} />
      )}

      {state.modal === 'sched' && state.modalDealId === deal.id && (
        <SchedModal deal={deal} lang={lang} onBooked={() => handleCallResult('Plan Call')} />
      )}
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function relTime(iso: string | undefined): string {
  if (!iso) return '--'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return '<1m'
  if (d < 3600000) return Math.round(d / 60000) + 'm'
  if (d < 86400000) return Math.round(d / 3600000) + 'u'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}
