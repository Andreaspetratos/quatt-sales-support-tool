'use client'

import { useState, useRef, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateMap, translateArr } from '@/lib/i18n'
import { storeSharedPbs, storeSharedScheds, fetchFeedbacks, updateFeedbackStatus, deleteFeedback, isProdSyncAvailable, syncFromProd, uid } from '@/lib/storage'
import { fetchAllLeadProperties, fetchLeadPropertyOptions, LEAD_PROPS } from '@/lib/hubspot'
import { CONFIG } from '@/lib/config'
import { ADMIN_TEAM_IDS } from '@/lib/access'
import { showToast } from './Toast'
import type { Playbook, Phase, Question, Scheduler, TechCheckOutcome, Feedback, FeedbackStatus, Rep } from '@/lib/types'
import { apiFetch } from '@/lib/auth'

type AdminTab = 'playbooks' | 'schedulers' | 'feedback' | 'diagnostics'

// ── Deep clone helper ─────────────────────────────────────────────────────────
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) }

// ── HubSpot property picker (searchable dropdown) ────────────────────────────
function HsPropPicker({ value, onChange }: { value: string; onChange: (propName: string, fieldType?: string, propOptions?: Array<{ label: string; value: string }>) => void }) {
  const [query, setQuery] = useState('')
  const [allProps, setAllProps] = useState<Array<{ name: string; label: string; type: string; fieldType: string }>>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  const currentProp = allProps.find(p => p.name === value)
  const displayValue = currentProp ? currentProp.label : value

  async function loadProps() {
    if (loaded) return
    const props = await fetchAllLeadProperties()
    setAllProps(props)
    setLoaded(true)
  }

  const filtered = query.length > 0
    ? allProps.filter(p =>
        p.label.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 40)
    : allProps.slice(0, 40)

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="inp inp-sm"
        value={open ? query : displayValue}
        placeholder="Zoek property op naam…"
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { setOpen(true); setQuery(''); loadProps() }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery('') }, 200)}
      />
      {value && !open && (
        <div style={{ fontSize: 10, color: 'var(--gm)', fontFamily: 'monospace', marginTop: 2 }}>
          {value}
          <span
            style={{ marginLeft: 6, cursor: 'pointer', color: 'var(--rd)' }}
            onMouseDown={e => { e.preventDefault(); onChange('') }}
          >✕</span>
        </div>
      )}
      {open && loaded && (
        <div style={{
          position: 'absolute', zIndex: 9999, left: 0, right: 0,
          bottom: 'calc(100% + 2px)',
          background: 'var(--wh)', border: '1px solid var(--gl)', borderRadius: 8,
          boxShadow: '0 -6px 24px rgba(0,0,0,.15)', maxHeight: 280, overflowY: 'auto',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '10px', fontSize: 12, color: 'var(--gm)' }}>Geen properties gevonden</div>
          )}
          {filtered.map(p => (
            <div
              key={p.name}
              style={{
                padding: '7px 10px', cursor: 'pointer', fontSize: 12,
                borderBottom: '1px solid var(--gl)',
                background: p.name === value ? 'rgba(26,122,107,.08)' : undefined,
              }}
              onMouseDown={async () => {
                const enumFieldTypes = ['select', 'radio', 'checkbox', 'booleancheckbox']
                let opts: Array<{ label: string; value: string }> = []
                if (enumFieldTypes.includes(p.fieldType)) {
                  try { opts = await fetchLeadPropertyOptions(p.name) } catch {}
                }
                onChange(p.name, p.fieldType, opts)
                setOpen(false)
                setQuery('')
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--bk)' }}>{p.label}</div>
              <div style={{ color: 'var(--gm)', fontFamily: 'monospace', fontSize: 10 }}>{p.name} · {p.fieldType}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── QCard — extracted to module level to prevent unmount/remount on state change ─
interface QCardProps {
  q: Question
  pi: number
  qi: number
  phases: Phase[]
  typeLabels: Record<string, string>
  qTypes: string[]
  onUpdateField: (pi: number, qi: number, k: keyof Question, v: any) => void
  onUpdateFields: (pi: number, qi: number, updates: Partial<Question>) => void
  onRemove: (pi: number, qi: number) => void
  onMove: (pi: number, qi: number, dir: -1 | 1) => void
  onMoveToPhase: (pi: number, qi: number, targetPi: number) => void
  onAddOption: (pi: number, qi: number, val: string) => void
  onRemoveOption: (pi: number, qi: number, oi: number) => void
  onAddTcOutcome: (pi: number, qi: number) => void
  onRemoveTcOutcome: (pi: number, qi: number, oi: number) => void
  onUpdateTcOutcomeField: (pi: number, qi: number, oi: number, k: keyof TechCheckOutcome, v: string) => void
  onAddChipOption: (pi: number, qi: number, val: string) => void
  onRemoveChipOption: (pi: number, qi: number, oi: number) => void
}

function QCard({
  q, pi, qi, phases, typeLabels, qTypes,
  onUpdateField, onUpdateFields, onRemove, onMove, onMoveToPhase,
  onAddOption, onRemoveOption,
  onAddTcOutcome, onRemoveTcOutcome, onUpdateTcOutcomeField,
  onAddChipOption, onRemoveChipOption,
}: QCardProps) {
  return (
    <div className="qcard">
      <div className="qcard-hd">
        <span className="qcard-type">{typeLabels[q.type] || q.type}</span>
        <span className="qcard-lbl">{q.label || q.content || '(empty)'}</span>
        {q.hsProperty && <span className="hs-badge">→ {q.hsProperty}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <button className="btn btn-xs" title="Move up" style={{ padding: '2px 5px', fontSize: 11 }} onClick={() => onMove(pi, qi, -1)}>▲</button>
          <button className="btn btn-xs" title="Move down" style={{ padding: '2px 5px', fontSize: 11 }} onClick={() => onMove(pi, qi, 1)}>▼</button>
          {phases.length > 1 && (
            <select
              className="sel"
              style={{ fontSize: 11, padding: '2px 4px', height: 24 }}
              value={pi}
              onChange={e => onMoveToPhase(pi, qi, Number(e.target.value))}
              title="Move to phase"
            >
              {phases.map((ph, idx) => (
                <option key={idx} value={idx}>{ph.label || `Phase ${idx + 1}`}</option>
              ))}
            </select>
          )}
          <button className="btn btn-dn btn-xs" onClick={() => onRemove(pi, qi)}>✕</button>
        </div>
      </div>

      {/* Type selector */}
      <div className="iw">
        <label className="il">Question type</label>
        <select className="sel" value={q.type} onChange={e => onUpdateField(pi, qi, 'type', e.target.value as any)}>
          {qTypes.map(tp => <option key={tp} value={tp}>{typeLabels[tp]}</option>)}
        </select>
      </div>

      {/* script / info */}
      {(q.type === 'script' || q.type === 'info') && (
        <div className="iw">
          <label className="il">Content</label>
          <textarea className="ta" rows={3} defaultValue={q.content || ''}
            onBlur={e => onUpdateField(pi, qi, 'content', e.target.value)} />
        </div>
      )}

      {/* open_text */}
      {q.type === 'open_text' && (
        <>
          <div className="iw">
            <label className="il">Vraag / instructie voor agent</label>
            <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
              onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--gm)', padding: '2px 0' }}>
            ✎ Agent typt vrije tekst → toegevoegd aan <code>personal_info___notes</code>
          </div>
        </>
      )}

      {/* list_options */}
      {q.type === 'list_options' && (
        <>
          <div className="iw">
            <label className="il">Vraag / instructie voor agent</label>
            <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
              onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Antwoord opties</label>
            <div className="opt-chips">
              {(q.options || []).map((o, oi) => (
                <span key={oi} className="opt-chip">
                  {o}<span className="opt-rm" onClick={() => onRemoveOption(pi, qi, oi)}>×</span>
                </span>
              ))}
              <input className="inp inp-sm" style={{ width: 160 }} placeholder="Optie toevoegen…"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { onAddOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--gm)', padding: '2px 0' }}>
            ☑ Geselecteerde optie → toegevoegd aan <code>personal_info___notes</code> als "Vraag - Optie"
          </div>
        </>
      )}

      {/* multi_select — same editor as list_options, but several answers allowed */}
      {q.type === 'multi_select' && (
        <>
          <div className="iw">
            <label className="il">Vraag / instructie voor agent</label>
            <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
              onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Antwoord opties</label>
            <div className="opt-chips">
              {(q.options || []).map((o, oi) => (
                <span key={oi} className="opt-chip">
                  {o}<span className="opt-rm" onClick={() => onRemoveOption(pi, qi, oi)}>×</span>
                </span>
              ))}
              <input className="inp inp-sm" style={{ width: 160 }} placeholder="Optie toevoegen…"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { onAddOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--gm)', padding: '2px 0' }}>
            ☑ Meerdere opties mogelijk. Agent klikt &quot;Opslaan&quot; → toegevoegd aan <code>personal_info___notes</code> als &quot;Vraag - Optie A, Optie B&quot;
          </div>
        </>
      )}

      {/* update_property */}
      {q.type === 'update_property' && (
        <>
          <div className="iw">
            <label className="il">Vraag / label voor agent</label>
            <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
              onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">HubSpot property</label>
            <HsPropPicker
              value={q.hsProperty || ''}
              onChange={(propName, fieldType, opts) => {
                onUpdateFields(pi, qi, {
                  hsProperty: propName,
                  hubspotPropFieldType: fieldType || '',
                  hubspotPropOptions: opts || [],
                })
              }}
            />
          </div>
          {q.hubspotPropFieldType && (
            <div style={{ fontSize: 11, color: 'var(--gm)', padding: '2px 0' }}>
              Field type: <strong>{q.hubspotPropFieldType}</strong>
              {q.hubspotPropOptions && q.hubspotPropOptions.length > 0 && (
                <span> · {q.hubspotPropOptions.length} opties geladen</span>
              )}
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gd)', cursor: 'pointer' }}>
            <input type="checkbox" className="chk" defaultChecked={!!q.required}
              onChange={e => onUpdateField(pi, qi, 'required', e.target.checked)} />
            Verplicht veld
          </label>
        </>
      )}

      {/* legacy types (choice, textarea, intent, address, outcome, tech_check) kept for existing playbooks */}
      {/* No Prefix input for address: the block writes straight to the lead's
          postal_code / house_number / house_number_suffix, so a prefix would
          configure nothing. Any prefix already saved on an existing address
          question is simply ignored. */}
      {q.type === 'address' && (
        <div style={{ fontSize: 11, color: 'var(--gm)', padding: '2px 0' }}>
          📮 Agent vult postcode, huisnummer en toevoeging in — deze worden direct
          op de lead opgeslagen. Straat en woonplaats komen automatisch uit PostNL.
        </div>
      )}
      {q.type === 'outcome' && (
        <>
          <div className="iw">
            <label className="il">Prefix</label>
            <input className="inp inp-sm" defaultValue={q.prefix || 'cp_'}
              onBlur={e => onUpdateField(pi, qi, 'prefix', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Extra notitie (optioneel)</label>
            <input className="inp inp-sm" defaultValue={q.altProdNote || ''}
              onBlur={e => onUpdateField(pi, qi, 'altProdNote', e.target.value)} />
          </div>
        </>
      )}
      {q.type === 'tech_check' && (
        <>
          <div className="iw">
            <label className="il">Label / titel</label>
            <input className="inp inp-sm" defaultValue={q.label || ''}
              onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Agent vraag</label>
            <textarea className="ta" rows={2} defaultValue={q.agentQuestion || ''}
              onBlur={e => onUpdateField(pi, qi, 'agentQuestion', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Chip state key</label>
            <input className="inp inp-sm" defaultValue={q.chipKey || ''}
              onBlur={e => onUpdateField(pi, qi, 'chipKey', e.target.value)} />
          </div>
          <div className="iw">
            <label className="il">Uitkomsten</label>
            {(q.outcomes || []).map((o, oi) => (
              <div key={oi} style={{ border: '1px solid var(--cb)', borderRadius: 7, padding: 7, marginBottom: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px auto', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                  <input className="inp inp-sm" placeholder="Situatie" defaultValue={o.condition || ''}
                    onBlur={e => onUpdateTcOutcomeField(pi, qi, oi, 'condition', e.target.value)} />
                  <input className="inp inp-sm" placeholder="Resultaat" defaultValue={o.result || ''}
                    onBlur={e => onUpdateTcOutcomeField(pi, qi, oi, 'result', e.target.value)} />
                  <select className="sel" defaultValue={o.color || 'var(--gr)'}
                    onChange={e => onUpdateTcOutcomeField(pi, qi, oi, 'color', e.target.value)}>
                    <option value="var(--gr)">✓ Groen</option>
                    <option value="var(--rd)">✖ Rood</option>
                    <option value="var(--or)">→ Oranje</option>
                    <option value="#f59e0b">⏸ Geel</option>
                  </select>
                  <button className="btn btn-dn btn-xs" onClick={() => onRemoveTcOutcome(pi, qi, oi)}>✕</button>
                </div>
                <textarea className="ta" rows={2} placeholder="Script (optioneel)…" defaultValue={o.script || ''}
                  onBlur={e => onUpdateTcOutcomeField(pi, qi, oi, 'script', e.target.value)} />
              </div>
            ))}
            <button className="btn btn-sc btn-xs" onClick={() => onAddTcOutcome(pi, qi)}>+ Uitkomst toevoegen</button>
          </div>
          <div className="iw">
            <label className="il">Chip opties (klant selectie)</label>
            <div className="opt-chips">
              {(q.chipOptions || []).map((o, oi) => (
                <span key={oi} className="opt-chip">
                  {o}<span className="opt-rm" onClick={() => onRemoveChipOption(pi, qi, oi)}>×</span>
                </span>
              ))}
              <input className="inp inp-sm" style={{ width: 160 }} placeholder="Optie toevoegen…"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { onAddChipOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
            </div>
          </div>
        </>
      )}
      {!['script','info','address','outcome','tech_check','open_text','list_options','multi_select','update_property'].includes(q.type) && (
        <div className="iw">
          <label className="il">Label</label>
          <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
            onBlur={e => onUpdateField(pi, qi, 'label', e.target.value)} />
        </div>
      )}
      {q.type === 'choice' && !q.hsProperty && (
        <div className="iw">
          <label className="il">Opties</label>
          <div className="opt-chips">
            {(q.options || []).map((o, oi) => (
              <span key={oi} className="opt-chip">
                {o}<span className="opt-rm" onClick={() => onRemoveOption(pi, qi, oi)}>×</span>
              </span>
            ))}
            <input className="inp inp-sm" style={{ width: 110 }} placeholder="Enter…"
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { onAddOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
          </div>
        </div>
      )}
      {q.type === 'intent' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <div className="iw"><label className="il">🔥 Hot</label><input className="inp inp-sm" defaultValue={q.hotDesc || ''} onBlur={e => onUpdateField(pi, qi, 'hotDesc', e.target.value)} /></div>
          <div className="iw"><label className="il">🌤 Warm</label><input className="inp inp-sm" defaultValue={q.warmDesc || ''} onBlur={e => onUpdateField(pi, qi, 'warmDesc', e.target.value)} /></div>
          <div className="iw"><label className="il">❄️ Cold</label><input className="inp inp-sm" defaultValue={q.coldDesc || ''} onBlur={e => onUpdateField(pi, qi, 'coldDesc', e.target.value)} /></div>
        </div>
      )}
      {!['script','info','address','outcome','tech_check','open_text','list_options','multi_select','update_property'].includes(q.type) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="iw" style={{ flex: 1, minWidth: 140 }}>
            <label className="il">HubSpot property</label>
            <HsPropPicker value={q.hsProperty || ''} onChange={(v) => onUpdateField(pi, qi, 'hsProperty', v)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gd)', cursor: 'pointer', flexShrink: 0 }}>
            <input type="checkbox" className="chk" defaultChecked={!!q.required}
              onChange={e => onUpdateField(pi, qi, 'required', e.target.checked)} />
            Verplicht
          </label>
        </div>
      )}
    </div>
  )
}

// ── Playbook editor ───────────────────────────────────────────────────────────
function PlaybookEditor({
  pb, onSave, onDelete, lang,
}: { pb: Playbook; onSave: (p: Playbook) => void; onDelete: (id: string) => void; lang: 'nl' | 'en' }) {
  const [ep, setEp] = useState<Playbook>(clone(pb))
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const matchInputRef = useRef<HTMLInputElement>(null)
  const [productOptions, setProductOptions] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    fetchLeadPropertyOptions('most_recent_selected_product_lead').then(opts => {
      setProductOptions(opts)
    })
  }, [])
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const typeLabels = translateMap(lang, 'adQTypeLabels')
  const qTypes = translateArr(lang, 'adQTypes')

  function update(partial: Partial<Playbook>) {
    setEp(prev => ({ ...prev, ...partial }))
  }

  function addMatch(val: string) {
    if (!val.trim()) return
    update({ productMatches: [...(ep.productMatches || []), val.trim()] })
    if (matchInputRef.current) matchInputRef.current.value = ''
  }

  function removeMatch(i: number) {
    update({ productMatches: ep.productMatches.filter((_, idx) => idx !== i) })
  }

  function addPhase() {
    const ni = (ep.phases || []).length
    const np: Phase = { id: uid(), label: t('adPhaseNum', ni + 1) as string, questions: [] }
    update({ phases: [...(ep.phases || []), np] })
    setExpandedPhase(ni)
  }

  function removePhase(pi: number) {
    const phases = ep.phases.filter((_, i) => i !== pi)
    update({ phases })
    if (expandedPhase === pi) setExpandedPhase(null)
  }

  function updatePhaseLabel(pi: number, label: string) {
    const phases = ep.phases.map((ph, i) => i === pi ? { ...ph, label } : ph)
    update({ phases })
  }

  function addQuestion(pi: number) {
    const q: Question = { id: uid(), type: 'script', content: '', label: '', options: [] }
    const phases = ep.phases.map((ph, i) => i === pi ? { ...ph, questions: [...ph.questions, q] } : ph)
    update({ phases })
  }

  function removeQuestion(pi: number, qi: number) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.filter((_, j) => j !== qi) }
      : ph)
    update({ phases })
  }

  function moveQuestion(pi: number, qi: number, dir: -1 | 1) {
    const phases = ep.phases.map((ph, i) => {
      if (i !== pi) return ph
      const qs = [...ph.questions]
      const target = qi + dir
      if (target < 0 || target >= qs.length) return ph
      ;[qs[qi], qs[target]] = [qs[target], qs[qi]]
      return { ...ph, questions: qs }
    })
    update({ phases })
  }

  function moveQuestionToPhase(pi: number, qi: number, targetPi: number) {
    if (targetPi === pi) return
    const q = ep.phases[pi].questions[qi]
    const phases = ep.phases.map((ph, i) => {
      if (i === pi) return { ...ph, questions: ph.questions.filter((_, j) => j !== qi) }
      if (i === targetPi) return { ...ph, questions: [...ph.questions, q] }
      return ph
    })
    update({ phases })
  }

  function updateQField(pi: number, qi: number, k: keyof Question, v: any) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, [k]: v } : q) }
      : ph)
    update({ phases })
  }

  function updateQFields(pi: number, qi: number, updates: Partial<import('@/lib/types').Question>) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, ...updates } : q) }
      : ph)
    update({ phases })
  }

  function addQOption(pi: number, qi: number, val: string) {
    if (!val.trim()) return
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, options: [...(q.options || []), val.trim()] } : q) }
      : ph)
    update({ phases })
  }

  function removeQOption(pi: number, qi: number, oi: number) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, options: (q.options || []).filter((_, k) => k !== oi) } : q) }
      : ph)
    update({ phases })
  }

  // tech_check outcome helpers
  function addTcOutcome(pi: number, qi: number) {
    const o: TechCheckOutcome = { condition: '', result: '', color: 'var(--gr)', script: '' }
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, outcomes: [...(q.outcomes || []), o] } : q) }
      : ph)
    update({ phases })
  }

  function removeTcOutcome(pi: number, qi: number, oi: number) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, outcomes: (q.outcomes || []).filter((_, k) => k !== oi) } : q) }
      : ph)
    update({ phases })
  }

  function updateTcOutcomeField(pi: number, qi: number, oi: number, k: keyof TechCheckOutcome, v: string) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi
        ? { ...q, outcomes: (q.outcomes || []).map((o, k2) => k2 === oi ? { ...o, [k]: v } : o) }
        : q) }
      : ph)
    update({ phases })
  }

  function addChipOption(pi: number, qi: number, val: string) {
    if (!val.trim()) return
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, chipOptions: [...(q.chipOptions || []), val.trim()] } : q) }
      : ph)
    update({ phases })
  }

  function removeChipOption(pi: number, qi: number, oi: number) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, chipOptions: (q.chipOptions || []).filter((_, k) => k !== oi) } : q) }
      : ph)
    update({ phases })
  }

  const { state } = useApp()
  const pbJson = JSON.stringify(state.playbooks, null, 2)
  const schJson = JSON.stringify(state.schedulers, null, 2)

  return (
    <div className="pb-editor">
      {/* Header row */}
      <div className="pb-editor-hd">
        <div className="iw" style={{ flex: 1, minWidth: 180 }}>
          <label className="il">{t('adPbName')}</label>
          <input className="inp" type="text" defaultValue={ep.name || ''} placeholder={t('adPbNameHint') as string}
            onBlur={e => update({ name: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-pr btn-sm" onClick={() => onSave(ep)}>{t('adSavePb')}</button>
          <button className="btn btn-sc btn-sm" onClick={() => setShowExport(true)}>{t('adExport')}</button>
          <button className="btn btn-dn btn-sm" onClick={() => { if (confirm(t('adDelConfirm') as string)) onDelete(ep.id) }}>{t('adDelPb')}</button>
        </div>
      </div>

      {/* Product match tags */}
      <div className="iw">
        <label className="il">{t('adPbTrigger')}</label>
        {productOptions.length > 0 ? (
          <div className="cr2" style={{ flexWrap: 'wrap' }}>
            {productOptions.map(opt => {
              const isSelected = (ep.productMatches || []).some(
                m => m.toLowerCase() === opt.value.toLowerCase() || m.toLowerCase() === opt.label.toLowerCase()
              )
              return (
                <button
                  key={opt.value}
                  className={`chip ${isSelected ? 'on' : ''}`}
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    if (isSelected) {
                      update({ productMatches: (ep.productMatches || []).filter(
                        m => m.toLowerCase() !== opt.value.toLowerCase() && m.toLowerCase() !== opt.label.toLowerCase()
                      )})
                    } else {
                      update({ productMatches: [...(ep.productMatches || []), opt.value] })
                    }
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        ) : (
          /* Fallback: text input if HubSpot options couldn't load */
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(ep.productMatches || []).map((m, i) => (
              <span key={i} className="opt-chip">{m}<span className="opt-rm" onClick={() => removeMatch(i)}>×</span></span>
            ))}
            <input
              ref={matchInputRef}
              className="inp inp-sm" style={{ width: 140 }}
              placeholder={t('adPbTriggerHint') as string}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { addMatch((e.target as HTMLInputElement).value); e.preventDefault() } }}
            />
            <span style={{ fontSize: 11, color: 'var(--gm)' }}>{t('adEnterToAdd')}</span>
          </div>
        )}
      </div>

      {/* Phases */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t('adPbPhases')}</span>
          <button className="btn btn-sc btn-sm" onClick={addPhase}>{t('adAddPhase')}</button>
        </div>
        {(ep.phases || []).map((phase, pi) => {
          const isOpen = expandedPhase === pi
          const qc = (phase.questions || []).length
          return (
            <div key={phase.id} className="pb-sec" style={{ marginBottom: 10 }}>
              <div className={`pb-sec-hd ${isOpen ? 'open' : ''}`} onClick={() => setExpandedPhase(isOpen ? null : pi)}>
                <div className="pb-phase-name">
                  <span style={{ background: isOpen ? 'rgba(255,255,255,.15)' : 'var(--gg)', color: isOpen ? '#fff' : 'var(--gd)', padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{pi + 1}</span>
                  <span className="pb-sec-title">{phase.label || t('adPhaseNum', pi + 1)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: isOpen ? 'rgba(255,255,255,.6)' : 'var(--gm)' }}>{t('adQCount', qc)}</span>
                  <button className={`btn btn-xs ${isOpen ? 'btn-sc' : 'btn-gh'}`}
                    style={isOpen ? { borderColor: 'rgba(255,255,255,.3)', color: '#fff', background: 'transparent' } : {}}
                    onClick={e => { e.stopPropagation(); removePhase(pi) }}>✕</button>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d={isOpen ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
                  </svg>
                </div>
              </div>
              {isOpen && (
                <div className="pb-sec-body">
                  <div className="iw">
                    <label className="il">{t('adPhaseName')}</label>
                    <input className="inp inp-sm" type="text" defaultValue={phase.label || ''}
                      onBlur={e => updatePhaseLabel(pi, e.target.value)} />
                  </div>
                  {(phase.questions || []).map((q, qi) => (
                    <QCard
                      key={q.id}
                      q={q} pi={pi} qi={qi}
                      phases={ep.phases}
                      typeLabels={typeLabels}
                      qTypes={qTypes}
                      onUpdateField={updateQField}
                      onUpdateFields={updateQFields}
                      onRemove={removeQuestion}
                      onMove={moveQuestion}
                      onMoveToPhase={moveQuestionToPhase}
                      onAddOption={addQOption}
                      onRemoveOption={removeQOption}
                      onAddTcOutcome={addTcOutcome}
                      onRemoveTcOutcome={removeTcOutcome}
                      onUpdateTcOutcomeField={updateTcOutcomeField}
                      onAddChipOption={addChipOption}
                      onRemoveChipOption={removeChipOption}
                    />
                  ))}
                  <button className="btn btn-sc btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                    onClick={() => addQuestion(pi)}>
                    {t('adAddQ')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Export modal */}
      {showExport && (
        <div className="mb" onClick={e => { if (e.target === e.currentTarget) setShowExport(false) }}>
          <div className="mo" style={{ maxWidth: 580 }}>
            <div className="moh">
              <div className="mot">{t('adExport')}</div>
              <button className="xb" onClick={() => setShowExport(false)}>✕</button>
            </div>
            <div className="mob">
              <p style={{ fontSize: 12, color: 'var(--gd)' }}>{t('adExportNote')}</p>
              <div>
                <div className="sl2" style={{ marginBottom: 5 }}>CONFIG.CUSTOM_PLAYBOOKS</div>
                <pre className="exp-pre">{pbJson}</pre>
                <button className="btn btn-sc btn-xs" style={{ marginTop: 5 }}
                  onClick={() => navigator.clipboard?.writeText(pbJson).then(() => showToast(t('copy') + ' ✓', 'success')).catch(() => {})}>
                  {t('copy')}
                </button>
              </div>
              <div>
                <div className="sl2" style={{ marginBottom: 5 }}>CONFIG.CUSTOM_SCHEDULERS</div>
                <pre className="exp-pre">{schJson}</pre>
                <button className="btn btn-sc btn-xs" style={{ marginTop: 5 }}
                  onClick={() => navigator.clipboard?.writeText(schJson).then(() => showToast(t('copy') + ' ✓', 'success')).catch(() => {})}>
                  {t('copy')}
                </button>
              </div>
            </div>
            <div className="mof">
              <button className="btn btn-sc btn-sm" onClick={() => setShowExport(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scheduler editor ──────────────────────────────────────────────────────────
function SchedEditor({
  sched, isNew, onSave, onCancel, lang,
}: { sched: Scheduler; isNew: boolean; onSave: (s: Scheduler) => void; onCancel: () => void; lang: 'nl' | 'en' }) {
  const [es, setEs] = useState<Scheduler>(clone(sched))
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  function upd(partial: Partial<Scheduler>) { setEs(prev => ({ ...prev, ...partial })) }

  return (
    <div style={{ padding: '0 20px 24px' }}>
      <div style={{ background: 'var(--wh)', border: '1px solid var(--gl)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{isNew ? t('adNewSch2') : t('adEditSch2')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="iw">
            <label className="il">{t('adSchName')}</label>
            <input className="inp" type="text" defaultValue={es.name || ''} placeholder={t('adSchNameHint') as string}
              onBlur={e => upd({ name: e.target.value })} />
          </div>
          <div className="iw">
            <label className="il">{t('adSchBtnLabel')}</label>
            <input className="inp" type="text" defaultValue={es.buttonLabel || ''} placeholder={t('schedVC') as string}
              onBlur={e => upd({ buttonLabel: e.target.value })} />
          </div>
        </div>
        <div className="iw">
          <label className="il">{t('adSchUrl')}</label>
          <input className="inp" type="url" defaultValue={es.url || ''} placeholder="https://meetings.hubspot.com/…"
            onBlur={e => upd({ url: e.target.value })} />
        </div>
        <div className="iw">
          <label className="il">{t('adSchProd')}</label>
          <SchedProductPicker
            value={es.productMatches || []}
            onChange={vals => upd({ productMatches: vals })}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" className="chk" defaultChecked={!!es.isDefault} onChange={e => upd({ isDefault: e.target.checked })} />
          {t('adSchDefault')}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-pr btn-sm" onClick={() => onSave(es)}>{t('adSaveSch')}</button>
          <button className="btn btn-gh btn-sm" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}


// ── HubSpot Diagnostics ────────────────────────────────────────────────────────
type DiagStatus = 'ok' | 'warn' | 'fail'
type DiagResult = { section: string; label: string; status: DiagStatus; detail: string }

async function hsCall(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; text: string; ms: number }> {
  const t0 = Date.now()
  const res = await apiFetch('/api/hs-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text, ms: Date.now() - t0 }
}

function parseJson(text: string): any {
  try { return JSON.parse(text) } catch { return {} }
}

function parseHsErr(text: string): string {
  try {
    const d = JSON.parse(text)
    let msg = d.message || d.error || text.slice(0, 500)
    if (Array.isArray(d.validationResults) && d.validationResults.length) {
      const fields = d.validationResults
        .map((r: { name?: string; error?: string; message?: string }) =>
          [r.name, r.error, r.message].filter(Boolean).join(':'))
        .join(', ')
      msg += ` → missing/invalid fields: [${fields}]`
    }
    return msg
  } catch { return text.slice(0, 500) }
}

function HsDiagnostics({ rep }: { rep: Rep | null }) {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<DiagResult[]>([])

  async function runTests() {
    setRunning(true)
    setResults([])
    const out: DiagResult[] = []
    let section = ''

    function add(label: string, status: DiagStatus | boolean, detail: string) {
      const s: DiagStatus = status === true ? 'ok' : status === false ? 'fail' : status
      out.push({ section, label, status: s, detail })
      setResults([...out])
    }
    const fail = (r: { status: number; text: string }) => `HTTP ${r.status}: ${parseHsErr(r.text)}`

    const ownerId = rep?.hubspotOwnerId || ''
    const email = rep?.email || ''

    try {
      // ── Connection ──────────────────────────────────────────────────────────
      section = 'Connection'
      const auth = await hsCall('GET', '/crm/v3/owners?limit=1')
      add('Auth (token valid)', auth.ok, auth.ok ? `HTTP ${auth.status} · ${auth.ms} ms` : fail(auth))
      if (!auth.ok) return

      const me = await hsCall('GET', '/integrations/v1/me')
      add('HubSpot portal', me.ok, me.ok ? `Portal ID ${parseJson(me.text).portalId ?? '?'} — check this is the portal you expect (sandbox vs production)` : fail(me))

      // ── Your account ────────────────────────────────────────────────────────
      section = 'Your account'
      const own = await hsCall('GET', `/crm/v3/owners?email=${encodeURIComponent(email)}&limit=1`)
      const foundOwner = own.ok ? String(parseJson(own.text).results?.[0]?.id ?? '') : ''
      if (!own.ok) add('Owner record', false, fail(own))
      else if (!foundOwner) add('Owner record', false, `No HubSpot owner found for ${email} — this user can't own leads or tasks`)
      else if (foundOwner !== ownerId) add('Owner record', 'warn', `HubSpot owner ${foundOwner}, but the tool is using ${ownerId || '(none)'} — sign out and in again`)
      else add('Owner record', true, `Owner ${foundOwner}`)

      const us = await hsCall('POST', '/crm/v3/objects/users/search', {
        filterGroups: [{ filters: [{ propertyName: 'hs_email', operator: 'EQ', value: email }] }],
        properties: ['hs_email', 'hubspot_team_id', 'hs_user_secondary_teams'],
        limit: 1,
      })
      const user = us.ok ? parseJson(us.text).results?.[0] : null
      if (!us.ok) add('User record + teams', false, fail(us))
      else if (!user) add('User record + teams', false, `No HubSpot user found for ${email} — "request leads" won't work`)
      else {
        const p = user.properties || {}
        const teams = [p.hubspot_team_id || '', ...(p.hs_user_secondary_teams || '').split(';')].map((x: string) => x.trim()).filter(Boolean)
        const adminTeam = teams.some((x: string) => ADMIN_TEAM_IDS.includes(x))
        add('User record + teams', true, `User ${user.id}. Teams: [${teams.join(', ') || 'none'}]. In an admin team: ${adminTeam ? 'yes' : 'no'}`)
      }

      // ── Lead setup ──────────────────────────────────────────────────────────
      section = 'Lead setup'
      const lp = await hsCall('GET', '/crm/v3/properties/leads?limit=500')
      if (lp.ok) {
        const names = new Set<string>((parseJson(lp.text).results || []).map((p: any) => p.name))
        const needed = Array.from(new Set([...LEAD_PROPS, ...Object.values(CONFIG.PROPS), 'personal_info___notes']))
        const missing = needed.filter(n => !names.has(n))
        add('Lead properties the tool uses', missing.length === 0,
          missing.length ? `Missing in HubSpot (renamed or deleted?): ${missing.join(', ')}` : `All ${needed.length} properties exist`)
      } else add('Lead properties the tool uses', false, fail(lp))

      const st = await hsCall('GET', '/crm/v3/properties/leads/hs_pipeline_stage')
      if (st.ok) {
        const opts = new Set<string>((parseJson(st.text).options || []).map((o: any) => String(o.value)))
        const missing = Object.entries(CONFIG.STAGES).filter(([, id]) => !opts.has(id)).map(([k, id]) => `${k} (${id})`)
        if (!opts.size) add('Pipeline stages', 'warn', 'HubSpot returned no stage list, so the stage IDs could not be checked')
        else add('Pipeline stages', missing.length === 0,
          missing.length ? `Stage IDs not found in HubSpot: ${missing.join(', ')}` : `All ${Object.keys(CONFIG.STAGES).length} stage IDs exist`)
      } else add('Pipeline stages', false, fail(st))

      const co = await hsCall('GET', `/crm/v3/properties/leads/${CONFIG.PROPS.callOutcome}`)
      if (co.ok) {
        const n = (parseJson(co.text).options || []).length
        add('Call outcome options', n > 0 ? true : 'warn', n > 0 ? `${n} options` : 'No options defined — reps have nothing to pick')
      } else add('Call outcome options', false, fail(co))

      // ── Leads ───────────────────────────────────────────────────────────────
      section = 'Leads'
      let leadId: string | null = null
      const mine = await hsCall('POST', '/crm/v3/objects/leads/search', {
        filterGroups: [{ filters: [
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
          { propertyName: 'hs_pipeline', operator: 'EQ', value: CONFIG.PIPELINE_ID },
          { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: CONFIG.STAGES.MQL },
        ] }],
        properties: LEAD_PROPS,
        sorts: [{ propertyName: 'screening_call_requested_at', direction: 'DESCENDING' }],
        limit: 1,
      })
      if (mine.ok) {
        const d = parseJson(mine.text)
        leadId = d.results?.[0]?.id ?? null
        add('Your board (MQL leads)', d.total > 0 ? true : 'warn', d.total > 0 ? `${d.total} leads · ${mine.ms} ms` : 'Search works, but you have no MQL leads assigned')
      } else add('Your board (MQL leads)', false, fail(mine))

      const all = await hsCall('POST', '/crm/v3/objects/leads/search', {
        filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: CONFIG.PIPELINE_ID }] }],
        properties: ['hs_lead_name'],
        limit: 1,
      })
      const anyLeadId: string | null = all.ok ? (parseJson(all.text).results?.[0]?.id ?? null) : null
      add('Lead search (whole pipeline)', all.ok, all.ok ? `${parseJson(all.text).total ?? 0} leads in the pipeline · ${all.ms} ms` : fail(all))

      // Read-only checks can use any lead; the task-link test below only uses one of yours.
      const readId = leadId || anyLeadId
      let contactEmail = ''
      if (!readId) {
        add('Open a lead', 'warn', 'Skipped — no lead found to read')
      } else {
        const one = await hsCall('GET', `/crm/v3/objects/leads/${readId}?properties=${LEAD_PROPS.join(',')}`)
        add('Open a lead', one.ok, one.ok ? `Lead ${readId}` : fail(one))

        const ca = await hsCall('GET', `/crm/v4/objects/leads/${readId}/associations/contacts?limit=1`)
        const contactId = ca.ok ? parseJson(ca.text).results?.[0]?.toObjectId : null
        if (!ca.ok) add('Lead → contact', false, fail(ca))
        else if (!contactId) add('Lead → contact', 'warn', `Lead ${readId} has no contact linked`)
        else {
          const c = await hsCall('GET', `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone`)
          contactEmail = c.ok ? (parseJson(c.text).properties?.email || '') : ''
          add('Lead → contact', c.ok, c.ok ? `Contact ${contactId}` : fail(c))
        }

        const da = await hsCall('GET', `/crm/v4/objects/leads/${readId}/associations/deals`)
        add('Lead → deal', da.ok, da.ok ? `${(parseJson(da.text).results || []).length} deal(s) linked` : fail(da))
      }

      // ── Tasks ───────────────────────────────────────────────────────────────
      section = 'Tasks'
      const schema = await hsCall('GET', '/crm/v3/properties/tasks')
      if (schema.ok) {
        const props: any[] = parseJson(schema.text).results || []
        const names = new Set(props.map(p => p.name))
        const missing = ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_type', 'hs_timestamp', 'hubspot_owner_id'].filter(n => !names.has(n))
        const typeVals = props.find(p => p.name === 'hs_task_type')?.options?.map((o: any) => o.value) || []
        const typeOk = typeVals.includes('TODO')
        add('Task properties', missing.length === 0 && typeOk,
          missing.length ? `Missing: ${missing.join(', ')}` : typeOk ? `All task properties exist. Types: ${typeVals.join(', ')}` : `Task type TODO not allowed. Types: ${typeVals.join(', ')}`)
      } else add('Task properties', false, fail(schema))

      const ts = await hsCall('POST', '/crm/v3/objects/tasks/search', {
        filterGroups: [{ filters: [
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
          { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
        ] }],
        properties: ['hs_task_subject', 'hs_timestamp'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
        limit: 1,
      })
      add('Your open tasks', ts.ok, ts.ok ? `${parseJson(ts.text).total ?? 0} open · ${ts.ms} ms` : fail(ts))

      const labels = await hsCall('GET', '/crm/v4/associations/tasks/leads/labels')
      const types: Array<{ typeId: number; label?: string; category?: string }> = labels.ok ? (parseJson(labels.text).results || []) : []
      const assocType = types.find(x => !x.label) ?? types[0]
      add('Task → lead link type', labels.ok && !!assocType,
        labels.ok ? (assocType ? `Type ${assocType.typeId}` : 'HubSpot returned no association types') : fail(labels))

      // Same properties as createHsTask() in lib/hubspot.ts.
      // HubSpot requires hs_timestamp (the task's due date) on every task.
      const create = await hsCall('POST', '/crm/v3/objects/tasks', {
        properties: {
          hs_task_subject: '[diag] test task',
          hs_task_body: 'Sales Support Tool diagnostic — deleted automatically',
          hs_task_status: 'NOT_STARTED',
          hs_task_type: 'TODO',
          hs_timestamp: String(Date.now() + 86400000),
          hubspot_owner_id: ownerId,
        },
      })
      const taskId: string | null = create.ok ? (parseJson(create.text).id ?? null) : null
      add('Create task', create.ok, create.ok ? `id=${taskId}` : fail(create))

      if (taskId) {
        // Link to one of your own leads only, so no other rep sees the test task
        if (!leadId || !assocType) {
          add('Link task to lead', 'warn', leadId ? 'Skipped — no link type' : 'Skipped — you have no lead on your board to link to')
        } else {
          const link = await hsCall('PUT', `/crm/v4/objects/tasks/${taskId}/associations/leads/${leadId}`,
            [{ associationCategory: assocType.category ?? 'HUBSPOT_DEFINED', associationTypeId: assocType.typeId }])
          add('Link task to lead', link.ok, link.ok ? `Linked to lead ${leadId}` : fail(link))

          if (link.ok) {
            const rb = await hsCall('POST', '/crm/v4/associations/tasks/leads/batch/read', { inputs: [{ id: taskId }] })
            const linked = rb.ok && (parseJson(rb.text).results || [])
              .some((r: any) => (r.to || []).some((t: any) => String(t.toObjectId) === String(leadId)))
            add('Read task → lead link', linked, rb.ok ? (linked ? 'Task shows under the lead' : 'Link not returned — tasks may not show on the lead') : fail(rb))
          }
        }

        const upd = await hsCall('PATCH', `/crm/v3/objects/tasks/${taskId}`, { properties: { hs_task_status: 'COMPLETED' } })
        add('Complete task', upd.ok, upd.ok ? `HTTP ${upd.status}` : fail(upd))

        const del = await hsCall('DELETE', `/crm/v3/objects/tasks/${taskId}`)
        add('Delete task (cleanup)', del.ok, del.ok ? `HTTP ${del.status}` : `${fail(del)} — delete task ${taskId} manually in HubSpot`)
      }

      // ── Contact activity ────────────────────────────────────────────────────
      section = 'Contact activity'
      if (!contactEmail) {
        add('Marketing emails', 'warn', 'Skipped — no contact email to look up')
      } else {
        const ev = await hsCall('GET', `/email/public/v1/events?recipient=${encodeURIComponent(contactEmail)}&limit=1`)
        add('Marketing emails', ev.ok, ev.ok ? 'Email events readable' : fail(ev))
      }
      const cp = await hsCall('GET', '/communication-preferences/v3/definitions')
      add('Subscription types', cp.ok, cp.ok ? `${(parseJson(cp.text).subscriptionDefinitions || []).length} subscription types` : fail(cp))

      // ── Shared data (Cloudflare KV) ─────────────────────────────────────────
      section = 'Shared data'
      const stores = [
        { label: 'Playbooks',  path: '/api/playbooks' },
        { label: 'Schedulers', path: '/api/schedulers' },
        { label: 'Feedback',   path: '/api/feedback' },
      ]
      for (const { label, path } of stores) {
        const res = await apiFetch(path)
        const text = await res.text()
        const data = parseJson(text)
        add(label, res.ok && Array.isArray(data),
          res.ok ? (Array.isArray(data) ? `${data.length} stored` : `Unexpected response: ${text.slice(0, 200)}`) : `HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
    } catch (e) {
      add('Diagnostics stopped', false, e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const counts = { ok: 0, warn: 0, fail: 0 }
  results.forEach(r => { counts[r.status]++ })
  const style: Record<DiagStatus, { bg: string; bd: string; icon: string }> = {
    ok:   { bg: 'var(--gn, #d1fae5)',     bd: 'var(--gn-bd, #6ee7b7)', icon: '✓' },
    warn: { bg: 'var(--yl-bg, #fef3c7)',  bd: 'var(--yl-bd, #fcd34d)', icon: '!' },
    fail: { bg: 'var(--rd-bg, #fee2e2)',  bd: 'var(--rd-bd, #fca5a5)', icon: '✗' },
  }

  return (
    <div style={{ padding: 20 }}>
      <p style={{ marginBottom: 16, fontSize: 13, color: 'var(--gm)' }}>
        Tests every HubSpot operation the tool uses, plus its shared data. Runs directly from this browser — no DevTools needed.
        Creates one test task (linked to one of your own leads), then deletes it again.
      </p>
      <button className="btn btn-pr" onClick={runTests} disabled={running}>
        {running ? '⏳ Running…' : '▶ Run HubSpot diagnostics'}
      </button>
      {results.length > 0 && (
        <p style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--ct)' }}>
          {counts.ok} passed · {counts.warn} warnings · {counts.fail} failed{running ? ' · running…' : ''}
        </p>
      )}
      {results.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r, i) => (
            <div key={i}>
              {r.section !== results[i - 1]?.section && (
                <div style={{ margin: '12px 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--cs)' }}>{r.section}</div>
              )}
              <div style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 12,
                background: style[r.status].bg, border: `1px solid ${style[r.status].bd}`,
              }}>
                <span style={{ fontWeight: 600 }}>{style[r.status].icon} {r.label}</span>
                <div style={{ marginTop: 3, color: 'var(--tx)', opacity: 0.8, wordBreak: 'break-all' }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { state, setState } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const [tab, setTab] = useState<AdminTab>('playbooks')
  const [selectedPbId, setSelectedPbId] = useState<string | null>(null)
  const [editingSched, setEditingSched] = useState<Scheduler | null>(null)
  const [isNewSched, setIsNewSched] = useState(false)

  const pbs = state.playbooks
  const scheds = state.schedulers
  const selectedPb = pbs.find(p => p.id === selectedPbId) || null

  function newPb() {
    const nb: Playbook = { id: uid(), name: '', productMatches: [], phases: [] }
    const updated = [nb, ...state.playbooks]
    setState({ playbooks: updated })
    storeSharedPbs(updated).catch(e => { console.error('[admin] save playbooks failed:', e); showToast('Opslaan mislukt — probeer opnieuw', 'error') })
    setSelectedPbId(nb.id)
  }

  function savePb(pb: Playbook) {
    const all = [...state.playbooks]
    const idx = all.findIndex(p => p.id === pb.id)
    if (idx >= 0) all[idx] = pb; else all.unshift(pb)
    setState({ playbooks: all })
    // Only confirm once the server has it — a failed save used to show "Saved" anyway
    storeSharedPbs(all)
      .then(() => showToast(t('toastSaved'), 'success'))
      .catch(e => { console.error('[admin] save playbooks failed:', e); showToast('Opslaan mislukt — probeer opnieuw', 'error') })
  }

  function deletePb(id: string) {
    const filtered = state.playbooks.filter(p => p.id !== id)
    setState({ playbooks: filtered })
    storeSharedPbs(filtered).catch(e => { console.error('[admin] delete playbook failed:', e); showToast('Verwijderen mislukt — probeer opnieuw', 'error') })
    if (selectedPbId === id) setSelectedPbId(null)
  }

  function newSched() {
    setEditingSched({ id: uid(), name: '', buttonLabel: '', url: '', productMatch: '', isDefault: false })
    setIsNewSched(true)
  }

  function editSched(id: string) {
    const s = state.schedulers.find(x => x.id === id)
    if (s) { setEditingSched(clone(s)); setIsNewSched(false) }
  }

  function saveSched(s: Scheduler) {
    const all = [...state.schedulers]
    const idx = all.findIndex(x => x.id === s.id)
    if (idx >= 0) all[idx] = s; else all.push(s)
    setState({ schedulers: all })
    setEditingSched(null)
    storeSharedScheds(all)
      .then(() => showToast(t('toastSaved'), 'success'))
      .catch(e => { console.error('[admin] save schedulers failed:', e); showToast('Opslaan mislukt — probeer opnieuw', 'error') })
  }

  function deleteSched(id: string) {
    if (!confirm(t('adDelConfirm') as string)) return
    const filtered = state.schedulers.filter(s => s.id !== id)
    setState({ schedulers: filtered })
    storeSharedScheds(filtered)
      .catch(e => { console.error('[admin] delete scheduler failed:', e); showToast('Verwijderen mislukt — probeer opnieuw', 'error') })
    if (editingSched?.id === id) setEditingSched(null)
  }

  return (
    <div className="adm">
      <button
        className="btn btn-xs"
        style={{ marginBottom: 8, color: 'var(--gm)', border: '1px solid var(--dk)', background: 'transparent' }}
        onClick={() => setState({ screen: 'dashboard' })}
      >
        ← {t('backToSales')}
      </button>
      <SandboxSyncBanner lang={lang} />
      <div className="adm-nav">
        <button className={`adm-tab ${tab === 'playbooks' ? 'on' : ''}`} onClick={() => setTab('playbooks')}>{t('adPb')}</button>
        <button className={`adm-tab ${tab === 'schedulers' ? 'on' : ''}`} onClick={() => setTab('schedulers')}>{t('adSch')}</button>
        <button className={`adm-tab ${tab === 'feedback' ? 'on' : ''}`} onClick={() => setTab('feedback')}>💬 Feedback</button>
        <button className={`adm-tab ${tab === 'diagnostics' ? 'on' : ''}`} onClick={() => setTab('diagnostics')}>🔧 Diagnostics</button>
      </div>

      <div className="adm-body">
        {tab === 'playbooks' && (
          <>
            {/* Playbook list */}
            <div className="pb-list">
              <div className="pb-list-hd">
                <span className="pb-list-hd-t">{t('adPb')} ({pbs.length})</span>
                <button className="btn btn-pr btn-xs" onClick={newPb}>{t('adNewPb')}</button>
              </div>
              <div className="pb-list-scroll">
                {!pbs.length && <div style={{ padding: '14px 10px', fontSize: 12, color: 'var(--gm)' }}>{t('adNoPbs')}</div>}
                {pbs.map(pb => (
                  <div
                    key={pb.id}
                    className={`pb-item ${selectedPbId === pb.id ? 'sel' : ''}`}
                    onClick={() => setSelectedPbId(pb.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="pb-item-name">{pb.name || t('adNameless')}</div>
                      {pb.isBuiltin && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'rgba(26,122,107,.15)', color: 'var(--gr)', flexShrink: 0 }}>BUILT-IN</span>}
                    </div>
                    <div className="pb-item-meta">
                      {t('adQCount', (pb.phases || []).reduce((a, p) => a + (p.questions || []).length, 0))} · {(pb.productMatches || []).join(', ') || t('adNoTrigger')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Playbook editor */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {selectedPb
                ? <PlaybookEditor key={selectedPb.id} pb={selectedPb} onSave={savePb} onDelete={deletePb} lang={lang} />
                : (
                  <div className="adm-empty">
                    <div className="adm-empty-icon">📋</div>
                    <p style={{ fontSize: 13 }}>{t('adEditPbEmpty')}</p>
                  </div>
                )
              }
            </div>
          </>
        )}
        {tab === 'schedulers' && (
          <div className="adm-scroll">
            <div className="sc-grid">
              {scheds.map(s => (
                <div key={s.id} className={`sc-card ${s.isDefault ? 'def' : ''}`}>
                  <div>
                    <div className="sc-card-name">{s.name || t('adNameless')}</div>
                    {s.isDefault && <span className="badge bo" style={{ marginTop: 4 }}>{t('adDefault')}</span>}
                    <div className="sc-card-url" style={{ marginTop: 6 }}>{s.url || t('adNoUrl')}</div>
                    <div style={{ fontSize: 12, color: 'var(--gm)', marginTop: 3 }}>{t('adBtnLabelPrefix')} <strong>{s.buttonLabel || t('schedVC')}</strong></div>
                    {(s.productMatches?.length ?? 0) > 0 && <div style={{ fontSize: 11, color: 'var(--gm)', marginTop: 2 }}>{t('adMatchPrefix')} {(s.productMatches || []).join(', ')}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 'auto' }}>
                    <button className="btn btn-sc btn-sm" onClick={() => editSched(s.id)}>{t('edit')}</button>
                    <button className="btn btn-dn btn-xs" onClick={() => deleteSched(s.id)}>✕</button>
                  </div>
                </div>
              ))}
              <div className="sc-new" onClick={newSched}>
                <div className="sc-new-icon">＋</div>
                <div className="sc-new-lbl">{t('adNewSch')}</div>
              </div>
            </div>
            {editingSched && (
              <SchedEditor
                sched={editingSched}
                isNew={isNewSched}
                onSave={saveSched}
                onCancel={() => setEditingSched(null)}
                lang={lang}
              />
            )}
          </div>
        )}
        {tab === 'feedback' && (
          <div className="adm-scroll">
            <FeedbackTab lang={lang} />
          </div>
        )}
        {tab === 'diagnostics' && (
          <div className="adm-scroll">
            <HsDiagnostics rep={state.currentRep ?? null} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── SchedProductPicker — same pill UI as playbook product match ───────────────
function SchedProductPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [opts, setOpts] = useState<Array<{ label: string; value: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchLeadPropertyOptions('most_recent_selected_product_lead').then(o => setOpts(o))
  }, [])

  function toggle(v: string) {
    const lower = v.toLowerCase()
    const exists = value.some(x => x.toLowerCase() === lower)
    onChange(exists ? value.filter(x => x.toLowerCase() !== lower) : [...value, v])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {opts.length > 0 ? (
        <div className="cr2" style={{ flexWrap: 'wrap' }}>
          {opts.map(opt => {
            const sel = value.some(x => x.toLowerCase() === opt.value.toLowerCase() || x.toLowerCase() === opt.label.toLowerCase())
            return (
              <button key={opt.value} className={`chip ${sel ? 'on' : ''}`} style={{ fontSize: 12 }} onClick={() => toggle(opt.value)}>
                {opt.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {value.map((m, i) => (
            <span key={i} className="opt-chip">{m}<span className="opt-rm" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</span></span>
          ))}
          <input
            ref={inputRef}
            className="inp inp-sm"
            style={{ width: 140 }}
            placeholder="Product match…"
            onKeyDown={e => {
              const v = (e.target as HTMLInputElement).value.trim()
              if ((e.key === 'Enter' || e.key === ',') && v) {
                toggle(v);
                (e.target as HTMLInputElement).value = ''
                e.preventDefault()
              }
            }}
          />
        </div>
      )}
      <span style={{ fontSize: 11, color: 'var(--gm)' }}>Empty = default for all deals</span>
    </div>
  )
}

// ── SandboxSyncBanner — sandbox only: copy production KV data into sandbox (one-way) ─────
function SandboxSyncBanner({ lang }: { lang: 'nl' | 'en' }) {
  const [available, setAvailable] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => { isProdSyncAvailable().then(setAvailable) }, [])
  if (!available) return null

  async function sync() {
    const msg = lang === 'nl'
      ? 'Productiedata (playbooks, schedulers, feedback) naar sandbox kopiëren? Alle sandbox-data wordt overschreven. Productie verandert niet.'
      : 'Copy production data (playbooks, schedulers, feedback) into sandbox? All sandbox data will be overwritten. Production is not changed.'
    if (!confirm(msg)) return
    setSyncing(true)
    try {
      const counts = await syncFromProd()
      showToast(`✓ Copied: ${counts.playbooks} playbooks, ${counts.schedulers} schedulers, ${counts.feedbacks} feedback`, 'success')
      setTimeout(() => window.location.reload(), 800)   // reload so app state picks up the new playbooks/schedulers
    } catch (e) {
      console.error('[admin] sync from prod failed:', e)
      showToast((lang === 'nl' ? 'Kopiëren mislukt: ' : 'Copy failed: ') + String((e as Error).message || e), 'error')
      setSyncing(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8, padding: '8px 12px',
      borderRadius: 10, border: '1.5px solid var(--or)', background: 'rgba(247,102,34,.08)', fontSize: 12, color: 'var(--ct)',
    }}>
      <strong style={{ color: 'var(--or)' }}>SANDBOX</strong>
      <span>{lang === 'nl' ? 'Aparte opslag — wijzigingen hier bereiken productie niet.' : 'Separate storage — changes here never reach production.'}</span>
      <button className="btn btn-xs btn-sc" onClick={sync} disabled={syncing} style={{ marginLeft: 'auto' }}>
        {syncing ? '⏳…' : (lang === 'nl' ? '⬇ Productiedata kopiëren' : '⬇ Copy production data')}
      </button>
    </div>
  )
}

// ── FeedbackTab — admin view of submitted feedback with status, filter and multi-select copy ─────
const FEEDBACK_STATUSES: FeedbackStatus[] = ['open', 'in_progress', 'done', 'wont_do']
const FEEDBACK_STATUS_LABEL: Record<'nl' | 'en', Record<FeedbackStatus, string>> = {
  nl: { open: 'Open', in_progress: 'In behandeling', done: 'Klaar', wont_do: 'Wordt niet gedaan' },
  en: { open: 'Open', in_progress: 'In progress', done: 'Done', wont_do: "Won't do" },
}
const FEEDBACK_STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: 'var(--gm)', in_progress: 'var(--or)', done: 'var(--gr)', wont_do: 'var(--rd)',
}
const feedbackStatus = (f: Feedback): FeedbackStatus => f.status ?? 'open'

function FeedbackTab({ lang }: { lang: 'nl' | 'en' }) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackStatus>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const labels = FEEDBACK_STATUS_LABEL[lang]

  useEffect(() => {
    setLoading(true)
    fetchFeedbacks()
      .then(data => setFeedbacks(data))
      .finally(() => setLoading(false))
  }, [])

  const visible = statusFilter === 'all' ? feedbacks : feedbacks.filter(f => feedbackStatus(f) === statusFilter)
  const countFor = (s: 'all' | FeedbackStatus) =>
    s === 'all' ? feedbacks.length : feedbacks.filter(f => feedbackStatus(f) === s).length

  function changeFilter(s: 'all' | FeedbackStatus) {
    setStatusFilter(s)
    setSelected(new Set())   // selection is per filtered view — avoid copying hidden items
  }

  async function setStatus(f: Feedback, status: FeedbackStatus) {
    if (feedbackStatus(f) === status || savingId) return
    setSavingId(f.id)
    try {
      const updated = await updateFeedbackStatus(f.id, status)
      setFeedbacks(prev => prev.map(x => x.id === f.id ? { ...x, ...updated } : x))
      if (statusFilter !== 'all' && statusFilter !== status) {
        // Card drops out of the filtered view — drop it from the selection too
        setSelected(prev => { const next = new Set(prev); next.delete(f.id); return next })
      }
      showToast(`✓ ${labels[status]}`, 'success')
    } catch (e) {
      console.error('[admin] update feedback status failed:', e)
      showToast(lang === 'nl' ? 'Status opslaan mislukt — probeer opnieuw' : 'Saving status failed — try again', 'error')
    } finally {
      setSavingId(null)
    }
  }

  async function remove(f: Feedback) {
    const preview = f.message.length > 80 ? f.message.slice(0, 80) + '…' : f.message
    const msg = lang === 'nl'
      ? `Deze feedback definitief verwijderen?\n\n"${preview}"`
      : `Permanently delete this feedback?\n\n"${preview}"`
    if (savingId || !confirm(msg)) return
    setSavingId(f.id)
    try {
      await deleteFeedback(f.id)
      setFeedbacks(prev => prev.filter(x => x.id !== f.id))
      setSelected(prev => { const next = new Set(prev); next.delete(f.id); return next })
      showToast(lang === 'nl' ? '✓ Verwijderd' : '✓ Deleted', 'success')
    } catch (e) {
      console.error('[admin] delete feedback failed:', e)
      showToast(lang === 'nl' ? 'Verwijderen mislukt — probeer opnieuw' : 'Delete failed — try again', 'error')
    } finally {
      setSavingId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(visible.map(f => f.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function copySelected() {
    const items = feedbacks.filter(f => selected.has(f.id))
    const locale = lang === 'nl' ? 'nl-NL' : 'en-GB'
    const text = [
      `Feedback for review (${items.length} item${items.length !== 1 ? 's' : ''}):`,
      '',
      ...items.map(f => [
        `From: ${f.submittedBy}`,
        `Date: ${new Date(f.submittedAt).toLocaleString(locale)}`,
        `Status: ${FEEDBACK_STATUS_LABEL.en[feedbackStatus(f)]}`,
        `Message: ${f.message}`,
      ].join('\n')),
    ].join('\n\n---\n\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      showToast('✓ Copied to clipboard', 'success')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--gm)', fontSize: 13 }}>⏳ Loading…</div>
  }

  if (feedbacks.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--gm)', fontSize: 13 }}>
        {lang === 'nl' ? 'Nog geen feedback ontvangen.' : 'No feedback received yet.'}
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Status filter */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(['all', ...FEEDBACK_STATUSES] as const).map(s => (
          <button key={s} className={`chip ${statusFilter === s ? 'on' : ''}`} onClick={() => changeFilter(s)}>
            {s === 'all' ? (lang === 'nl' ? 'Alle' : 'All') : labels[s]} ({countFor(s)})
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-xs btn-gh" onClick={selectAll} disabled={visible.length === 0} style={{ fontSize: 12 }}>Select all</button>
        {selected.size > 0 && (
          <button className="btn btn-xs btn-gh" onClick={clearAll} style={{ fontSize: 12 }}>Clear</button>
        )}
        {selected.size > 0 && (
          <button
            className="btn btn-xs btn-pr"
            onClick={copySelected}
            style={{ fontSize: 12, marginLeft: 'auto' }}
          >
            {copied ? '✓ Copied!' : `Copy ${selected.size} selected`}
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--gm)', marginLeft: selected.size > 0 ? 0 : 'auto' }}>
          {visible.length} {visible.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {visible.length === 0 && (
        <div style={{ padding: '12px 0', color: 'var(--gm)', fontSize: 13 }}>
          {lang === 'nl' ? 'Geen feedback met deze status.' : 'No feedback with this status.'}
        </div>
      )}

      {/* Feedback cards */}
      {visible.map(f => {
        const isSelected = selected.has(f.id)
        const status = feedbackStatus(f)
        return (
          <div
            key={f.id}
            onClick={() => toggleSelect(f.id)}
            style={{
              background: isSelected ? 'rgba(26,122,107,.07)' : 'var(--c1)',
              border: `2px solid ${isSelected ? 'var(--gr)' : 'var(--gl)'}`,
              borderRadius: 12,
              padding: 16,
              cursor: 'pointer',
              transition: 'border-color .13s, background .13s',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            {/* Checkbox */}
            <div style={{
              width: 18, height: 18, borderRadius: 5, border: `2px solid ${isSelected ? 'var(--gr)' : 'var(--gg)'}`,
              background: isSelected ? 'var(--gr)' : 'transparent',
              flexShrink: 0, marginTop: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700,
            }}>
              {isSelected ? '✓' : ''}
            </div>
            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--gm)' }}>
                  {f.submittedBy} · {new Date(f.submittedAt).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB')}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  color: FEEDBACK_STATUS_COLOR[status], border: `1.5px solid ${FEEDBACK_STATUS_COLOR[status]}`,
                }}>
                  {labels[status]}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ct)', margin: 0, whiteSpace: 'pre-wrap' }}>{f.message}</p>
              {/* Status controls — stopPropagation so clicking doesn't toggle card selection */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }} onClick={e => e.stopPropagation()}>
                {FEEDBACK_STATUSES.map(s => (
                  <button
                    key={s}
                    className={`chip ${status === s ? 'on' : ''}`}
                    disabled={savingId === f.id}
                    onClick={() => setStatus(f, s)}
                    style={{ fontSize: 11, padding: '2px 8px', cursor: savingId === f.id ? 'wait' : 'pointer' }}
                  >
                    {labels[s]}
                  </button>
                ))}
                <button
                  className="btn btn-dn btn-xs"
                  disabled={savingId === f.id}
                  onClick={() => remove(f)}
                  style={{ marginLeft: 'auto', fontSize: 11 }}
                  title={lang === 'nl' ? 'Verwijderen' : 'Delete'}
                >
                  🗑 {lang === 'nl' ? 'Verwijderen' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
