'use client'

import { useState } from 'react'
import type { Playbook, Phase, Question, PlaybookState, TechCheckOutcome } from '@/lib/types'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { CONFIG } from '@/lib/config'
import { patchDeal } from '@/lib/hubspot'
import { showToast } from './Toast'

// ── InfoBlock — collapsible wb element ────────────────────────────────────────
function InfoBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`wb ${open ? 'open' : ''}`}>
      <div className="wb-hd" onClick={() => setOpen(o => !o)}>
        <span>ℹ</span>
        <span>Info</span>
        <span className="wb-arr">▾</span>
      </div>
      {open && (
        <div className="wb-body" dangerouslySetInnerHTML={{ __html: content }} />
      )}
    </div>
  )
}

// ── Script block ──────────────────────────────────────────────────────────────
function ScriptBlock({ content }: { content: string }) {
  return <div className="sb" dangerouslySetInnerHTML={{ __html: content }} />
}

// ── Address block ─────────────────────────────────────────────────────────────
function AddressBlock({
  prefix, dealId, getPbNote, setPbNote,
}: { prefix: string; dealId: string; getPbNote: (k: string) => string; setPbNote: (k: string, v: string) => void }) {
  const pfx = prefix || 'cp_'
  return (
    <div className="ag">
      <div className="iw" style={{ gridColumn: '1 / -1' }}>
        <label className="il">Straat</label>
        <input className="inp" type="text" defaultValue={getPbNote(pfx + 'str')} onBlur={e => setPbNote(pfx + 'str', e.target.value)} placeholder="Straatnaam" />
      </div>
      <div className="iw">
        <label className="il">Huisnr</label>
        <input className="inp" type="text" defaultValue={getPbNote(pfx + 'nr')} onBlur={e => setPbNote(pfx + 'nr', e.target.value)} />
      </div>
      <div className="iw">
        <label className="il">Toev.</label>
        <input className="inp" type="text" defaultValue={getPbNote(pfx + 'tv')} onBlur={e => setPbNote(pfx + 'tv', e.target.value)} placeholder="kan leeg zijn" />
      </div>
      <div className="iw">
        <label className="il">Postcode</label>
        <input className="inp" type="text" defaultValue={getPbNote(pfx + 'pc')} onBlur={e => setPbNote(pfx + 'pc', e.target.value)} />
      </div>
      <div className="iw">
        <label className="il">Woonplaats</label>
        <input className="inp" type="text" defaultValue={getPbNote(pfx + 'wp')} onBlur={e => setPbNote(pfx + 'wp', e.target.value)} />
      </div>
    </div>
  )
}

// ── Outcome block ─────────────────────────────────────────────────────────────
function OutcomeBlock({
  prefix, altProdNote, dealId, getPbAnswer, setPbAnswer, getPbNote, setPbNote, lang,
}: {
  prefix: string; altProdNote?: string; dealId: string
  getPbAnswer: (k: string) => string; setPbAnswer: (k: string, v: string) => void
  getPbNote: (k: string) => string; setPbNote: (k: string, v: string) => void
  lang: 'nl' | 'en'
}) {
  const pfx = prefix || 'cp_'
  const sel = getPbAnswer(pfx + 'out')

  return (
    <>
      <div className="dv" />
      <div className="ql">Call outcome <span className="qr">*</span></div>
      <div>
        <div className={`io ${sel === 'hv' ? 'sh' : ''}`} onClick={() => setPbAnswer(pfx + 'out', 'hv')}>
          <div className="iot">🏠 Plan HV</div>
          Klik &quot;Plan HV&quot; als call outcome in het deal paneel.
        </div>
        <div className={`io ${sel === 'lt' ? 'sw' : ''}`} onClick={() => setPbAnswer(pfx + 'out', 'lt')}>
          <div className="iot">📅 Long-term opportunity</div>
          Timing &gt; 6 maanden.
          {sel === 'lt' && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
              <textarea className="inp" rows={2} placeholder="Waarom long-term opportunity?"
                defaultValue={getPbNote(pfx + 'lt_n')} onBlur={e => setPbNote(pfx + 'lt_n', e.target.value)} />
              <input className="inp" type="text" placeholder="Verwachte follow-up datum (DD-MM-YYYY)"
                defaultValue={getPbNote(pfx + 'lt_d')} onBlur={e => setPbNote(pfx + 'lt_d', e.target.value)} />
            </div>
          )}
        </div>
        <div className={`io ${sel === 'lost' ? 'sc' : ''}`} onClick={() => setPbAnswer(pfx + 'out', 'lost')}>
          <div className="iot">✖ Lost</div>
          Niet haalbaar of geen interesse.
          {sel === 'lost' && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
              <select className="inp" defaultValue={getPbNote(pfx + 'lr')} onChange={e => setPbNote(pfx + 'lr', e.target.value)}>
                <option value="">-- Reden --</option>
                {translateArr(lang, 'lostReasons').map(o => <option key={o}>{o}</option>)}
              </select>
              <textarea className="inp" rows={2} placeholder="Toelichting (min. 20 tekens)…"
                defaultValue={getPbNote(pfx + 'ln')} onBlur={e => setPbNote(pfx + 'ln', e.target.value)} />
            </div>
          )}
        </div>
      </div>
      {altProdNote && (
        <div className="wb" style={{ marginTop: 8 }}>💡 {altProdNote}</div>
      )}
    </>
  )
}

// ── Tech check block ──────────────────────────────────────────────────────────
function TechCheckBlock({
  q, getPbAnswer, setPbAnswer,
}: { q: Question; getPbAnswer: (k: string) => string; setPbAnswer: (k: string, v: string) => void }) {
  const chipKey = q.chipKey || q.id
  return (
    <div>
      <div className="ql">{q.label}</div>
      <div className="sb" style={{ fontSize: 12, marginBottom: 6 }}>
        <strong>Agent:</strong> &ldquo;{q.agentQuestion}&rdquo;
      </div>
      <div style={{ border: '1px solid var(--cb)', borderRadius: 8, overflow: 'hidden', fontSize: 12, marginBottom: 6 }}>
        {(q.outcomes || []).map((o, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'start', padding: '6px 10px', borderBottom: i < (q.outcomes || []).length - 1 ? '1px solid var(--cb)' : undefined }}>
            <div>
              <span style={{ color: 'var(--ct)' }}>{o.condition}</span>
              {o.script && (
                <details style={{ marginTop: 2 }}>
                  <summary style={{ color: 'var(--cs)', fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>▸ script</summary>
                  <div style={{ fontSize: 11, color: 'var(--cs)', fontStyle: 'italic', lineHeight: 1.5, paddingTop: 3, borderTop: '1px solid var(--cb)', marginTop: 3 }}>
                    {o.script}
                  </div>
                </details>
              )}
            </div>
            <span style={{ color: o.color || 'var(--ct)', fontWeight: 700, whiteSpace: 'nowrap' }}>{o.result}</span>
          </div>
        ))}
      </div>
      <div className="ql">{q.chipLabel || 'Situatie klant'}</div>
      <div className="cr2">
        {(q.chipOptions || []).map(opt => (
          <button
            key={opt}
            className={`chip ${getPbAnswer(chipKey) === opt ? 'on' : ''}`}
            onClick={() => setPbAnswer(chipKey, opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Single question renderer ──────────────────────────────────────────────────
function QuestionItem({
  q, dealId, pbState, setPbAnswer, setPbNote, lang,
}: {
  q: Question
  dealId: string
  pbState: PlaybookState
  setPbAnswer: (k: string, v: string) => void
  setPbNote: (k: string, v: string) => void
  lang: 'nl' | 'en'
}) {
  const getA = (k: string) => pbState.answers[k] || ''
  const getN = (k: string) => pbState.notes[k] || ''

  switch (q.type) {
    case 'script':
      return <ScriptBlock content={q.content || ''} />

    case 'info':
      return <InfoBlock content={q.content || ''} />

    case 'address':
      return (
        <AddressBlock
          prefix={q.prefix || 'cp_'}
          dealId={dealId}
          getPbNote={getN}
          setPbNote={setPbNote}
        />
      )

    case 'outcome':
      return (
        <OutcomeBlock
          prefix={q.prefix || 'cp_'}
          altProdNote={q.altProdNote}
          dealId={dealId}
          getPbAnswer={getA}
          setPbAnswer={setPbAnswer}
          getPbNote={getN}
          setPbNote={setPbNote}
          lang={lang}
        />
      )

    case 'tech_check':
      return <TechCheckBlock q={q} getPbAnswer={getA} setPbAnswer={setPbAnswer} />

    case 'choice':
      return (
        <div>
          <div className="ql">
            {q.label}
            {q.required && <span className="qr"> *</span>}
          </div>
          <div className="cr2">
            {(q.options || []).map(opt => (
              <button
                key={opt}
                className={`chip ${getA(q.id) === opt ? 'on' : ''}`}
                onClick={() => setPbAnswer(q.id, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
          {q.hsProperty && (
            <div className="hs-badge" style={{ marginTop: 4 }}>→ {q.hsProperty}</div>
          )}
          <textarea
            className="inp"
            style={{ marginTop: 5 }}
            rows={2}
            placeholder={translate(lang, 'callNotesPlaceholder')}
            defaultValue={getN(q.id + '_n')}
            onBlur={e => setPbNote(q.id + '_n', e.target.value)}
          />
        </div>
      )

    case 'textarea':
      return (
        <div className="iw">
          <label className="il">
            {q.label}
            {q.required && <span style={{ color: 'var(--rd)' }}> *</span>}
          </label>
          <textarea
            className="inp"
            rows={3}
            placeholder={q.placeholder || ''}
            defaultValue={getN(q.id)}
            onBlur={e => setPbNote(q.id, e.target.value)}
          />
          {q.hsProperty && <div className="hs-badge">→ {q.hsProperty}</div>}
        </div>
      )

    case 'intent':
      return (
        <div>
          <div className="ql">
            {q.label || translate(lang, 'phIntent')}
            <span className="qr"> *</span>
          </div>
          <div>
            <div className={`io ${getA(q.id) === 'hot' ? 'sh' : ''}`} onClick={() => setPbAnswer(q.id, 'hot')}>
              <div className="iot">🔥 Hot</div>
              {q.hotDesc}
            </div>
            <div className={`io ${getA(q.id) === 'warm' ? 'sw' : ''}`} onClick={() => setPbAnswer(q.id, 'warm')}>
              <div className="iot">🌤 Warm</div>
              {q.warmDesc}
            </div>
            <div className={`io ${getA(q.id) === 'cold' ? 'sc' : ''}`} onClick={() => setPbAnswer(q.id, 'cold')}>
              <div className="iot">❄️ Cold</div>
              {q.coldDesc}
            </div>
          </div>
          {q.hsProperty && <div className="hs-badge" style={{ marginTop: 4 }}>→ {q.hsProperty}</div>}
        </div>
      )

    default:
      return null
  }
}

// ── Phase navigation pills ────────────────────────────────────────────────────
function PhaseNav({
  phases, pbState, onSetPhase,
}: { phases: Phase[]; pbState: PlaybookState; onSetPhase: (i: number) => void }) {
  if (phases.length < 2) return null
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', padding: '6px 12px', background: '#F8F9F8', borderRadius: 10, border: '1px solid var(--gl)' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gm)', textTransform: 'uppercase', letterSpacing: '.8px', marginRight: 2 }}>
        Fase:
      </span>
      {phases.map((ph, i) => {
        const isOpen = pbState.phaseIdx === i
        const isDone = !!pbState.answers[ph.id + '_done']
        const short = (ph.label || '').replace(/^(Fase|Phase)\s+\d+[:\s]*/i, '').trim() || String(i + 1)
        return (
          <button
            key={ph.id}
            onClick={() => onSetPhase(i)}
            style={{
              padding: '4px 11px', borderRadius: 99,
              border: `2px solid ${isOpen ? 'var(--bk)' : isDone ? 'var(--gr)' : 'var(--gg)'}`,
              background: isOpen ? 'var(--bk)' : isDone ? 'var(--grc)' : 'var(--wh)',
              color: isOpen ? '#fff' : isDone ? 'var(--gr)' : 'var(--gd)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'all .13s',
            }}
          >
            <span style={{ opacity: .7, fontSize: 10 }}>{isDone ? '✓' : i + 1}</span>
            <span>{short.length > 14 ? short.slice(0, 13) + '…' : short}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Playbook tab selector ─────────────────────────────────────────────────────
interface PlaybookTabsProps {
  pbDefs: Array<{ key: string; def: Playbook }>
  activeKey: string
  onSelect: (key: string) => void
}
function PlaybookTabs({ pbDefs, activeKey, onSelect }: PlaybookTabsProps) {
  if (pbDefs.length < 2) return null
  return (
    <div className="cr2" style={{ marginBottom: 8 }}>
      {pbDefs.map(({ key, def }) => {
        const label = def.name.replace(/ Kwalificatiegesprek| Qualification Call/gi, '').trim()
        return (
          <button
            key={key}
            className={`chip ${activeKey === key ? 'on' : ''}`}
            onClick={() => onSelect(key)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Main PlaybookView ─────────────────────────────────────────────────────────
interface PlaybookViewProps {
  dealId: string
  pbDefs: Array<{ key: string; def: Playbook }>
}

export default function PlaybookView({ dealId, pbDefs }: PlaybookViewProps) {
  const { state, getPbState, setPbAnswer, setPbNote, setPhase, setActivePb, donePhase, patchDealLocal } = useApp()
  const lang = state.lang
  const t = (key: string, ...args: any[]) => translate(lang, key, ...args)
  const pbState = getPbState(dealId)

  const activeKey = pbState.activePbKey && pbDefs.some(d => d.key === pbState.activePbKey)
    ? pbState.activePbKey
    : pbDefs[0]?.key

  const activePbInfo = pbDefs.find(d => d.key === activeKey) || pbDefs[0]
  if (!activePbInfo) return null

  const pb = activePbInfo.def
  const phases = pb.phases || []
  const idx = Math.max(0, Math.min(pbState.phaseIdx || 0, phases.length - 1))
  const phase = phases[idx]
  if (!phase) return null

  async function handleDonePhase() {
    // Collect HubSpot property values from answers
    const props: Record<string, string> = {}
    for (const q of phase.questions) {
      if (!q.hsProperty) continue
      let val = q.type === 'textarea' ? (pbState.notes[q.id] || '') : (pbState.answers[q.id] || '')
      if (!val) continue
      if (q.hsValueMap && q.hsValueMap[val]) val = q.hsValueMap[val]
      props[q.hsProperty] = val
    }
    // Patch deal if we have values to save
    if (Object.keys(props).length) {
      try {
        await patchDeal(dealId, props, state.deals, deals => patchDealLocal(dealId, props))
      } catch {}
    }
    donePhase(dealId, phase.id, idx + 1)
  }

  return (
    <div>
      {/* Playbook tab switcher (when multi-product deal) */}
      <PlaybookTabs
        pbDefs={pbDefs}
        activeKey={activeKey}
        onSelect={key => setActivePb(dealId, key)}
      />

      {/* Phase navigation */}
      <PhaseNav
        phases={phases}
        pbState={pbState}
        onSetPhase={i => setPhase(dealId, i)}
      />

      {/* Phase questions */}
      <div className="pb2" style={{ border: '1px solid var(--gl)', borderRadius: 11 }}>
        {phase.questions.map(q => (
          <QuestionItem
            key={q.id}
            q={q}
            dealId={dealId}
            pbState={pbState}
            setPbAnswer={(k, v) => setPbAnswer(dealId, k, v)}
            setPbNote={(k, v) => setPbNote(dealId, k, v)}
            lang={lang}
          />
        ))}

        {/* Phase action buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="btn btn-pr btn-sm" onClick={handleDonePhase}>
            {t('savePhase')}
          </button>
          {idx < phases.length - 1 && (
            <button className="btn btn-sc btn-sm" onClick={() => setPhase(dealId, idx + 1)}>
              {t('nextPhase')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
