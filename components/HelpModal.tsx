'use client'

import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { submitFeedback, resetOnboarding } from '@/lib/storage'
import { HELP_GROUPS, HELP_TOPICS, QUICK_START_STEPS, clipSrc, clipPoster, type HelpTopic } from '@/lib/helpContent'
import type { Lang } from '@/lib/types'
import { showToast } from './Toast'

export default function HelpModal() {
  const { state, setState } = useApp()
  const lang = state.lang
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)
  const isAdmin = state.isAdmin
  const [activeTab, setActiveTab] = useState<'instructions' | 'feedback'>('instructions')
  const [feedbackText, setFeedbackText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  // Clips that failed to load (not recorded yet, or offline): the topic shows its text only
  const [broken, setBroken] = useState<Record<string, boolean>>({})

  if (!state.helpOpen) return null

  async function handleSubmitFeedback() {
    if (!feedbackText.trim()) { showToast(lang === 'nl' ? 'Vul eerst feedback in' : 'Please enter feedback first', 'error'); return }
    setSubmitting(true)
    try {
      await submitFeedback(feedbackText.trim(), state.currentRep?.email || 'unknown')
      showToast(lang === 'nl' ? 'Feedback verzonden — bedankt!' : 'Feedback submitted — thank you!', 'success')
      setFeedbackText('')
      setState({ helpOpen: false })
    } catch {
      showToast(lang === 'nl' ? 'Verzenden mislukt, probeer opnieuw' : 'Submit failed, please try again', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResetQuickStart() {
    try {
      await resetOnboarding()
      showToast(t('helpQsResetDone'), 'success')
    } catch {
      showToast(t('helpQsResetFailed'), 'error')
    }
  }

  const q = query.trim().toLowerCase()
  const topics = HELP_TOPICS
    .filter(tp => !tp.adminOnly || isAdmin)
    .filter(tp => !q || [tp.title[lang], ...tp.steps[lang]].some(s => s.toLowerCase().includes(q)))

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setState({ helpOpen: false })}
    >
      <div
        style={{ background: 'var(--bg)', borderRadius: 16, width: 760, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.3)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px 0', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', flex: 1 }}>Help</span>
          <button onClick={() => setState({ helpOpen: false })} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--cs)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, padding: '12px 20px 0', borderBottom: '1px solid var(--gl)' }}>
          {(['instructions', 'feedback'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                border: 'none', background: 'none', cursor: 'pointer', padding: '6px 14px',
                fontWeight: activeTab === tab ? 700 : 400,
                color: activeTab === tab ? 'var(--pr)' : 'var(--gm)',
                borderBottom: activeTab === tab ? '2px solid var(--pr)' : '2px solid transparent',
                fontSize: 13, marginBottom: -1,
              }}
            >
              {tab === 'instructions' ? t('helpManual') : t('helpFeedback')}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', flex: 1 }}>
          {activeTab === 'instructions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Quick start guide — the same one new users get on their first login */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--or)', background: 'rgba(247,102,34,0.08)' }}>
                <span style={{ fontSize: 26 }} aria-hidden>🚀</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ct)' }}>{t('helpQsTitle')}</div>
                  <div style={{ fontSize: 12, color: 'var(--cs)' }}>{t('helpQsSub', QUICK_START_STEPS.length)}</div>
                </div>
                <button className="btn btn-pr btn-sm" onClick={() => setState({ helpOpen: false, quickStartOpen: true })}>{t('helpQsOpen')}</button>
              </div>

              <input
                className="inp"
                type="search"
                placeholder={t('helpSearch')}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />

              {topics.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--cs)', padding: '8px 0' }}>{t('helpNoResults')}</div>
              )}

              {HELP_GROUPS.map(g => {
                const inGroup = topics.filter(tp => tp.group === g.id)
                if (inGroup.length === 0) return null
                return (
                  <div key={g.id}>
                    <div className="sl2" style={{ marginBottom: 6 }}>{g.title[lang]}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--cb)', borderRadius: 10, overflow: 'hidden', background: 'var(--c1)' }}>
                      {inGroup.map((tp, i) => (
                        <TopicRow
                          key={tp.id}
                          topic={tp}
                          lang={lang}
                          first={i === 0}
                          open={openId === tp.id}
                          onToggle={() => setOpenId(id => id === tp.id ? null : tp.id)}
                          clipOk={!!tp.clip && !broken[tp.clip]}
                          onClipError={() => tp.clip && setBroken(b => ({ ...b, [tp.clip!]: true }))}
                          videoLabel={t('helpVideo')}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}

              {/* Admins test the first-login guide on themselves */}
              {isAdmin && (
                <button className="btn btn-xs" onClick={handleResetQuickStart} style={{ alignSelf: 'flex-start', color: 'var(--gm)' }}>
                  {t('helpQsReset')}
                </button>
              )}
            </div>
          )}
          {activeTab === 'feedback' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--gm)', margin: 0 }}>
                {lang === 'nl'
                  ? 'Heb je een bug gevonden, een idee, of iets dat beter kan? Laat het ons weten!'
                  : 'Found a bug, have an idea, or something that could be better? Let us know!'}
              </p>
              <textarea
                className="inp"
                rows={6}
                placeholder={lang === 'nl' ? 'Beschrijf je feedback zo specifiek mogelijk…' : 'Describe your feedback as specifically as possible…'}
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-pr btn-sm" onClick={handleSubmitFeedback} disabled={submitting}>
                  {submitting ? '⏳…' : (lang === 'nl' ? 'Verstuur feedback' : 'Submit feedback')}
                </button>
                <button className="btn btn-xs" onClick={() => setState({ helpOpen: false })} style={{ color: 'var(--gm)' }}>
                  {lang === 'nl' ? 'Annuleer' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// One collapsible topic: title row, and when open its clip (if any) and steps.
// The clip only loads once the topic is opened.
function TopicRow({ topic, lang, first, open, onToggle, clipOk, onClipError, videoLabel }: {
  topic: HelpTopic
  lang: Lang
  first: boolean
  open: boolean
  onToggle: () => void
  clipOk: boolean
  onClipError: () => void
  videoLabel: string
}) {
  return (
    <div style={{ borderTop: first ? 'none' : '1px solid var(--cb)' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', border: 'none', background: open ? 'var(--c2)' : 'transparent', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ct)', flex: 1 }}>{topic.title[lang]}</span>
        {clipOk && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--or)', border: '1px solid var(--or)', borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>▶ {videoLabel}</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 14px', background: 'var(--c2)' }}>
          {clipOk && topic.clip && (
            <video
              src={clipSrc(topic.clip)}
              poster={clipPoster(topic.clip)}
              controls autoPlay muted loop playsInline
              preload="metadata"
              onError={onClipError}
              style={{ width: '100%', aspectRatio: '16 / 10', borderRadius: 8, border: '1px solid var(--cb)', background: 'var(--c1)', display: 'block', marginBottom: 10 }}
            />
          )}
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {topic.steps[lang].map((step, j) => (
              <li key={j} style={{ fontSize: 13, color: 'var(--ct)', lineHeight: 1.5 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
