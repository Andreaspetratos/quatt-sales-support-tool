'use client'

import { useState } from 'react'
import { useApp } from '@/context/AppContext'
import { submitFeedback } from '@/lib/storage'
import { showToast } from './Toast'

interface Section {
  title: string
  steps: string[]
  adminOnly?: boolean
}

const SECTIONS_NL: Section[] = [
  { title: '📥 Hoe werkt leads aanvragen?', steps: ['Klik op de "Vraag leads aan" knop bovenaan het dashboard.','Er is een wachttijd van 60 seconden tussen aanvragen.','Leads worden toegewezen op basis van beschikbaarheid in de MQL-fase.','Na ontvangst zie je de nieuwe leads direct in de tabel.','Als je na de aftelling geen leads ziet, klik dan op vernieuwen en check of je een Slack-bericht van HubSpot hebt ontvangen.'] },
  { title: '📞 Hoe stel je de beluitkomst in?', steps: ['Open een lead door erop te klikken in de tabel.','Onderin de modal zie je de call outcome dropdown — selecteer de uitkomst die past.','De uitkomst wordt direct opgeslagen in HubSpot.'] },
  { title: '📝 Hoe vul je het playbook in?', steps: ['Open een lead — het playbook verschijnt als er een product geselecteerd is.','Doorloop de fases stap voor stap (pijlen links/rechts).','Beantwoord de vragen en vul aantekeningen in per stap.','Antwoorden worden automatisch opgeslagen per lead.'] },
  { title: '📊 Hoe lees je de prestatiemetrics?', steps: ['Klik op het 📊 icoon rechtsboven om de prestatielade te openen.','Kies de periode: Vandaag, Deze week of Deze maand.','Verwerkt = leads die jouw MQL-fase hebben verlaten.','SQL = leads die doorstroomden naar Sales Qualified Lead.','Lost = leads die zijn gecategoriseerd als verloren.'] },
  { title: '🛠 Hoe maak je een playbook? (Admin)', adminOnly: true, steps: ['Ga naar Admin via de knop rechtsboven.','Klik op "Nieuw playbook" en geef het een naam.','Voeg fases toe met de "+ Fase" knop.','Voeg per fase vragen toe en sla op — wijzigingen zijn direct zichtbaar.'] },
  { title: '🗓 Hoe koppel je een planner? (Admin)', adminOnly: true, steps: ['Ga naar Admin via de knop rechtsboven.','Klik op het tabblad "Planners".','Voeg een nieuwe planner toe en koppel je HubSpot-planner.','Kies welke producten deze planner activeren.'] },
]

const SECTIONS_EN: Section[] = [
  { title: '📥 How does requesting leads work?', steps: ['Click the "Request leads" button at the top of the dashboard.','There is a 60-second cooldown between requests.','Leads are assigned based on availability in the MQL stage.','New leads appear in the table immediately after requesting.'] },
  { title: '📞 How do you set the call outcome?', steps: ['Open a lead by clicking it in the table.','Use the call outcome dropdown above the playbook to select the result.','The outcome is saved to HubSpot immediately.'] },
  { title: '📝 How do you fill in the playbook?', steps: ['Open a lead — the playbook appears if a product is selected.','Navigate through phases using the left/right arrows.','Answer questions and add notes per step.','Answers are saved automatically per lead.'] },
  { title: '📊 How do you read the performance metrics?', steps: ['Click the 📊 icon in the top right to open the performance drawer.','Select a period: Today, This week, or This month.','Processed = leads that exited your MQL stage.','SQL = leads that progressed to Sales Qualified Lead.','Lost = leads categorised as lost.'] },
  { title: '🛠 How do you create a playbook? (Admin)', adminOnly: true, steps: ['Go to Admin via the button in the top right.','Click "New playbook" and give it a name.','Add phases and questions, then save — changes are immediately visible.'] },
  { title: '🗓 How do you connect a scheduler? (Admin)', adminOnly: true, steps: ['Go to Admin and click the "Schedulers" tab.','Add a scheduler and connect your HubSpot meeting link.','Select which products activate this scheduler.'] },
]

export default function HelpModal() {
  const { state, setState } = useApp()
  const lang = state.lang
  const sections = lang === 'nl' ? SECTIONS_NL : SECTIONS_EN
  const isAdmin = state.isAdmin
  const [activeTab, setActiveTab] = useState<'instructions' | 'feedback'>('instructions')
  const [feedbackText, setFeedbackText] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setState({ helpOpen: false })}
    >
      <div
        style={{ background: 'var(--bg)', borderRadius: 16, width: 560, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.3)' }}
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
              {tab === 'instructions' ? (lang === 'nl' ? '📖 Handleiding' : '📖 Instructions') : (lang === 'nl' ? '💬 Feedback' : '💬 Feedback')}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', flex: 1 }}>
          {activeTab === 'instructions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {sections.filter(s => !s.adminOnly || isAdmin).map((s, i) => (
                <div key={i}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 8 }}>{s.title}</div>
                  <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {s.steps.map((step, j) => (
                      <li key={j} style={{ fontSize: 13, color: 'var(--cs)', lineHeight: 1.5 }}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
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
