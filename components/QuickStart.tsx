'use client'

// The quick start guide: a few steps with a short clip each. AppShell opens it
// on a user's first login (once per email address, see /api/onboarding); Help
// opens it any time. Next to the end, Skip, ✕ or Esc all close it for good.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { QUICK_START_STEPS, clipSrc, clipPoster } from '@/lib/helpContent'
import { markOnboardingSeen } from '@/lib/storage'

export default function QuickStart() {
  const { state, setState } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const [idx, setIdx] = useState(0)
  // Clips that failed to load (not recorded yet, or offline): the step shows its icon instead
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const open = state.quickStartOpen && !!state.currentRep

  // Every opening starts at the first step
  useEffect(() => { if (open) setIdx(0) }, [open])

  const steps = QUICK_START_STEPS
  const step = steps[Math.min(idx, steps.length - 1)]
  const last = idx >= steps.length - 1

  function close() {
    setState({ quickStartOpen: false })
    markOnboardingSeen()
  }
  function next() { if (last) close(); else setIdx(i => i + 1) }
  function back() { setIdx(i => Math.max(0, i - 1)) }

  // No deps: bound again on every render, so the keys always act on the current step
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open) return null
  const clip = step.clip && !broken[step.clip] ? step.clip : null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('qsTitle')}
    >
      <div style={{ background: 'var(--c1)', border: '1px solid var(--cb)', borderRadius: 18, width: 760, maxWidth: '100%', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,.5)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px 10px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)', textTransform: 'uppercase', letterSpacing: '.5px', flex: 1 }}>
            {t('qsTitle')} · {t('qsStepOf', idx + 1, steps.length)}
          </span>
          <button onClick={close} title={t('qsSkip')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--cs)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '0 18px' }}>
          <div style={{ aspectRatio: '16 / 10', width: '100%', borderRadius: 10, overflow: 'hidden', background: 'var(--c2)', border: '1px solid var(--cb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {clip ? (
              <video
                key={clip}
                src={clipSrc(clip)}
                poster={clipPoster(clip)}
                autoPlay muted loop playsInline
                onError={() => setBroken(b => ({ ...b, [clip]: true }))}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <span style={{ fontSize: 64 }} aria-hidden>{step.id === 'help' ? '💬' : '🚀'}</span>
            )}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ct)', margin: '16px 0 6px' }}>{step.title[lang]}</div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ct)', margin: 0 }}>{step.body[lang]}</p>
        </div>

        {/* Footer: progress dots + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flex: 1 }} aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.id}
                onClick={() => setIdx(i)}
                style={{ width: i === idx ? 18 : 7, height: 7, borderRadius: 4, cursor: 'pointer', background: i === idx ? 'var(--or)' : 'var(--cb)', transition: 'width .2s' }}
              />
            ))}
          </div>
          {!last && <button className="btn btn-sc btn-sm" onClick={close}>{t('qsSkip')}</button>}
          {idx > 0 && <button className="btn btn-sc btn-sm" onClick={back}>{t('qsBack')}</button>}
          <button className="btn btn-pr btn-sm" onClick={next} autoFocus>{last ? t('qsDone') : t('qsNext')}</button>
        </div>
      </div>
    </div>
  )
}
