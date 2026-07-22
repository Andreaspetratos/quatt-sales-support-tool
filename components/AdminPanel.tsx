'use client'

import { useState, useRef } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateMap, translateArr } from '@/lib/i18n'
import { loadPbs, savePbs, loadScheds, saveScheds, uid } from '@/lib/storage'
import { fetchAllLeadProperties } from '@/lib/hubspot'
import { showToast } from './Toast'
import type { Playbook, Phase, Question, Scheduler, TechCheckOutcome } from '@/lib/types'

type AdminTab = 'playbooks' | 'schedulers'

// ── Deep clone helper ─────────────────────────────────────────────────────────
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) }

// ── HubSpot property picker (searchable dropdown) ────────────────────────────
function HsPropPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [inputVal, setInputVal] = useState(value || '')
  const [allProps, setAllProps] = useState<Array<{ name: string; label: string; type: string; fieldType: string }>>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  async function loadProps() {
    if (loaded) return
    const props = await fetchAllLeadProperties()
    setAllProps(props)
    setLoaded(true)
  }

  const filtered = inputVal.length > 0
    ? allProps.filter(p =>
        p.name.toLowerCase().includes(inputVal.toLowerCase()) ||
        p.label.toLowerCase().includes(inputVal.toLowerCase())
      ).slice(0, 20)
    : allProps.slice(0, 20)

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="inp inp-sm"
        value={inputVal}
        placeholder="Type to search or paste API name…"
        onChange={e => { setInputVal(e.target.value); onChange(e.target.value) }}
        onFocus={() => { setOpen(true); loadProps() }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && loaded && filtered.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 999, left: 0, right: 0, top: '100%',
          background: 'var(--wh)', border: '1px solid var(--gl)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,.1)', maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map(p => (
            <div
              key={p.name}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--gl)' }}
              onMouseDown={() => {
                setInputVal(p.name)
                onChange(p.name)
                setOpen(false)
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

// ── Playbook editor ───────────────────────────────────────────────────────────
function PlaybookEditor({
  pb, onSave, onDelete, lang,
}: { pb: Playbook; onSave: (p: Playbook) => void; onDelete: (id: string) => void; lang: 'nl' | 'en' }) {
  const [ep, setEp] = useState<Playbook>(clone(pb))
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const matchInputRef = useRef<HTMLInputElement>(null)
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

  function updateQField(pi: number, qi: number, k: keyof Question, v: any) {
    const phases = ep.phases.map((ph, i) => i === pi
      ? { ...ph, questions: ph.questions.map((q, j) => j === qi ? { ...q, [k]: v } : q) }
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

  function QCard({ q, pi, qi }: { q: Question; pi: number; qi: number }) {
    return (
      <div className="qcard">
        <div className="qcard-hd">
          <span className="qcard-type">{typeLabels[q.type] || q.type}</span>
          <span className="qcard-lbl">{q.label || q.content || t('adEmpty')}</span>
          {q.hsProperty && <span className="hs-badge">→ {q.hsProperty}</span>}
          <button className="btn btn-dn btn-xs" onClick={() => removeQuestion(pi, qi)}>✕</button>
        </div>

        {/* Type selector */}
        <div className="iw">
          <label className="il">{t('adQType')}</label>
          <select className="sel" value={q.type} onChange={e => updateQField(pi, qi, 'type', e.target.value as any)}>
            {qTypes.map(tp => <option key={tp} value={tp}>{typeLabels[tp]}</option>)}
          </select>
        </div>

        {/* Type-specific fields */}
        {(q.type === 'script' || q.type === 'info') && (
          <div className="iw">
            <label className="il">{t('adQContent')}</label>
            <textarea className="ta" rows={3} defaultValue={q.content || ''}
              onBlur={e => updateQField(pi, qi, 'content', e.target.value)} />
          </div>
        )}
        {q.type === 'address' && (
          <div className="iw">
            <label className="il">Prefix (staat voor de veldnamen)</label>
            <input className="inp inp-sm" defaultValue={q.prefix || 'cp_'}
              onBlur={e => updateQField(pi, qi, 'prefix', e.target.value)} />
          </div>
        )}
        {q.type === 'outcome' && (
          <>
            <div className="iw">
              <label className="il">Prefix</label>
              <input className="inp inp-sm" defaultValue={q.prefix || 'cp_'}
                onBlur={e => updateQField(pi, qi, 'prefix', e.target.value)} />
            </div>
            <div className="iw">
              <label className="il">Extra notitie (optioneel)</label>
              <input className="inp inp-sm" defaultValue={q.altProdNote || ''}
                onBlur={e => updateQField(pi, qi, 'altProdNote', e.target.value)} />
            </div>
          </>
        )}
        {q.type === 'tech_check' && (
          <>
            <div className="iw">
              <label className="il">Label / titel</label>
              <input className="inp inp-sm" defaultValue={q.label || ''}
                onBlur={e => updateQField(pi, qi, 'label', e.target.value)} />
            </div>
            <div className="iw">
              <label className="il">Agent vraag</label>
              <textarea className="ta" rows={2} defaultValue={q.agentQuestion || ''}
                onBlur={e => updateQField(pi, qi, 'agentQuestion', e.target.value)} />
            </div>
            <div className="iw">
              <label className="il">Chip state key</label>
              <input className="inp inp-sm" defaultValue={q.chipKey || ''}
                onBlur={e => updateQField(pi, qi, 'chipKey', e.target.value)} />
            </div>
            <div className="iw">
              <label className="il">Uitkomsten</label>
              {(q.outcomes || []).map((o, oi) => (
                <div key={oi} style={{ border: '1px solid var(--cb)', borderRadius: 7, padding: 7, marginBottom: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px auto', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                    <input className="inp inp-sm" placeholder="Situatie" defaultValue={o.condition || ''}
                      onBlur={e => updateTcOutcomeField(pi, qi, oi, 'condition', e.target.value)} />
                    <input className="inp inp-sm" placeholder="Resultaat" defaultValue={o.result || ''}
                      onBlur={e => updateTcOutcomeField(pi, qi, oi, 'result', e.target.value)} />
                    <select className="sel" defaultValue={o.color || 'var(--gr)'}
                      onChange={e => updateTcOutcomeField(pi, qi, oi, 'color', e.target.value)}>
                      <option value="var(--gr)">✓ Groen</option>
                      <option value="var(--rd)">✖ Rood</option>
                      <option value="var(--or)">→ Oranje</option>
                      <option value="#f59e0b">⏸ Geel</option>
                    </select>
                    <button className="btn btn-dn btn-xs" onClick={() => removeTcOutcome(pi, qi, oi)}>✕</button>
                  </div>
                  <textarea className="ta" rows={2} placeholder="Script (optioneel)…" defaultValue={o.script || ''}
                    onBlur={e => updateTcOutcomeField(pi, qi, oi, 'script', e.target.value)} />
                </div>
              ))}
              <button className="btn btn-sc btn-xs" onClick={() => addTcOutcome(pi, qi)}>+ Uitkomst toevoegen</button>
            </div>
            <div className="iw">
              <label className="il">Chip opties (klant selectie)</label>
              <div className="opt-chips">
                {(q.chipOptions || []).map((o, oi) => (
                  <span key={oi} className="opt-chip">
                    {o}<span className="opt-rm" onClick={() => removeChipOption(pi, qi, oi)}>×</span>
                  </span>
                ))}
                <input className="inp inp-sm" style={{ width: 160 }} placeholder="Optie toevoegen…"
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { addChipOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
              </div>
            </div>
          </>
        )}
        {!['script','info','address','outcome','tech_check'].includes(q.type) && (
          <div className="iw">
            <label className="il">{t('adQLabel')}</label>
            <input className="inp inp-sm" type="text" defaultValue={q.label || ''}
              onBlur={e => updateQField(pi, qi, 'label', e.target.value)} />
          </div>
        )}
        {q.type === 'choice' && (
          <div className="iw">
            <label className="il">{t('adQOptions')}</label>
            <div className="opt-chips">
              {(q.options || []).map((o, oi) => (
                <span key={oi} className="opt-chip">
                  {o}<span className="opt-rm" onClick={() => removeQOption(pi, qi, oi)}>×</span>
                </span>
              ))}
              <input className="inp inp-sm" style={{ width: 110 }} placeholder="Enter…"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { addQOption(pi, qi, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; e.preventDefault() } }} />
            </div>
          </div>
        )}
        {q.type === 'intent' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <div className="iw"><label className="il">🔥 Hot</label><input className="inp inp-sm" defaultValue={q.hotDesc || ''} onBlur={e => updateQField(pi, qi, 'hotDesc', e.target.value)} /></div>
            <div className="iw"><label className="il">🌤 Warm</label><input className="inp inp-sm" defaultValue={q.warmDesc || ''} onBlur={e => updateQField(pi, qi, 'warmDesc', e.target.value)} /></div>
            <div className="iw"><label className="il">❄️ Cold</label><input className="inp inp-sm" defaultValue={q.coldDesc || ''} onBlur={e => updateQField(pi, qi, 'coldDesc', e.target.value)} /></div>
          </div>
        )}
        {!['script','info','address','outcome','tech_check'].includes(q.type) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="iw" style={{ flex: 1, minWidth: 140 }}>
              <label className="il">{t('adQHsProp')}</label>
              <HsPropPicker value={q.hsProperty || ''} onChange={v => updateQField(pi, qi, 'hsProperty', v)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gd)', cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" className="chk" defaultChecked={!!q.required}
                onChange={e => updateQField(pi, qi, 'required', e.target.checked)} />
              {t('adQReq')}
            </label>
          </div>
        )}
      </div>
    )
  }

  const pbJson = JSON.stringify(loadPbs(), null, 2)
  const schJson = JSON.stringify(loadScheds(), null, 2)

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
                    <QCard key={q.id} q={q} pi={pi} qi={qi} />
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
          <div className="iw">
            <label className="il">{t('adSchProd')}</label>
            <input className="inp" type="text" defaultValue={es.productMatch || ''} placeholder={t('adSchProdHint') as string}
              onBlur={e => upd({ productMatch: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', paddingBottom: 10, whiteSpace: 'nowrap' }}>
            <input type="checkbox" className="chk" defaultChecked={!!es.isDefault} onChange={e => upd({ isDefault: e.target.checked })} />
            {t('adSchDefault')}
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-pr btn-sm" onClick={() => onSave(es)}>{t('adSaveSch')}</button>
          <button className="btn btn-gh btn-sm" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { state } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  const [tab, setTab] = useState<AdminTab>('playbooks')
  const [selectedPbId, setSelectedPbId] = useState<string | null>(null)
  const [editingSched, setEditingSched] = useState<Scheduler | null>(null)
  const [isNewSched, setIsNewSched] = useState(false)
  const [, forceUpdate] = useState(0)
  const refresh = () => forceUpdate(n => n + 1)

  const pbs = loadPbs()
  const scheds = loadScheds()
  const selectedPb = pbs.find(p => p.id === selectedPbId) || null

  function newPb() {
    const nb: Playbook = { id: uid(), name: '', productMatches: [], phases: [] }
    savePbs([nb, ...loadPbs()])
    setSelectedPbId(nb.id)
    refresh()
  }

  function savePb(pb: Playbook) {
    const all = loadPbs()
    const idx = all.findIndex(p => p.id === pb.id)
    if (idx >= 0) all[idx] = pb; else all.unshift(pb)
    savePbs(all)
    showToast(t('toastSaved'), 'success')
    refresh()
  }

  function deletePb(id: string) {
    savePbs(loadPbs().filter(p => p.id !== id))
    if (selectedPbId === id) setSelectedPbId(null)
    refresh()
  }

  function newSched() {
    setEditingSched({ id: uid(), name: '', buttonLabel: '', url: '', productMatch: '', isDefault: false })
    setIsNewSched(true)
  }

  function editSched(id: string) {
    const s = loadScheds().find(x => x.id === id)
    if (s) { setEditingSched(clone(s)); setIsNewSched(false) }
  }

  function saveSched(s: Scheduler) {
    const all = loadScheds()
    const idx = all.findIndex(x => x.id === s.id)
    if (idx >= 0) all[idx] = s; else all.push(s)
    saveScheds(all)
    setEditingSched(null)
    showToast(t('toastSaved'), 'success')
    refresh()
  }

  function deleteSched(id: string) {
    if (!confirm(t('adDelConfirm') as string)) return
    saveScheds(loadScheds().filter(s => s.id !== id))
    if (editingSched?.id === id) setEditingSched(null)
    refresh()
  }

  return (
    <div className="adm">
      <div className="adm-nav">
        <button className={`adm-tab ${tab === 'playbooks' ? 'on' : ''}`} onClick={() => setTab('playbooks')}>{t('adPb')}</button>
        <button className={`adm-tab ${tab === 'schedulers' ? 'on' : ''}`} onClick={() => setTab('schedulers')}>{t('adSch')}</button>
      </div>

      <div className="adm-body">
        {tab === 'playbooks' ? (
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
        ) : (
          /* Schedulers tab */
          <div className="adm-scroll">
            <div className="sc-grid">
              {scheds.map(s => (
                <div key={s.id} className={`sc-card ${s.isDefault ? 'def' : ''}`}>
                  <div>
                    <div className="sc-card-name">{s.name || t('adNameless')}</div>
                    {s.isDefault && <span className="badge bo" style={{ marginTop: 4 }}>{t('adDefault')}</span>}
                    <div className="sc-card-url" style={{ marginTop: 6 }}>{s.url || t('adNoUrl')}</div>
                    <div style={{ fontSize: 12, color: 'var(--gm)', marginTop: 3 }}>{t('adBtnLabelPrefix')} <strong>{s.buttonLabel || t('schedVC')}</strong></div>
                    {s.productMatch && <div style={{ fontSize: 11, color: 'var(--gm)', marginTop: 2 }}>{t('adMatchPrefix')} {s.productMatch}</div>}
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
      </div>
    </div>
  )
}
