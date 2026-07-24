'use client'

import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'

interface Section {
  title: string
  steps: string[]
  adminOnly?: boolean
}

const SECTIONS_NL: Section[] = [
  {
    title: '📥 Hoe werkt leads aanvragen?',
    steps: [
      'Klik op de "Vraag leads aan" knop onderaan het dashboard.',
      'Er is een wachttijd van 2 uur tussen aanvragen — dit zorgt voor eerlijke verdeling.',
      'Leads worden toegewezen op basis van beschikbaarheid in de MQL-fase.',
      'Na ontvangst zie je de nieuwe leads direct in de tabel.',
    ],
  },
  {
    title: '📞 Hoe stel je de beluitkomst in?',
    steps: [
      'Open een lead door erop te klikken in de tabel.',
      'Onderin de modal zie je drie knoppen: Home Visit, Schedule Videocall, Lost.',
      'Klik de uitkomst die het best past bij het gesprek.',
      'De uitkomst wordt direct opgeslagen in HubSpot.',
    ],
  },
  {
    title: '📝 Hoe vul je het playbook in?',
    steps: [
      'Open een lead — het playbook verschijnt rechts als er een product geselecteerd is.',
      'Doorloop de fases stap voor stap (pijlen links/rechts).',
      'Beantwoord de vragen en vul aantekeningen in per stap.',
      'Antwoorden worden automatisch opgeslagen per lead.',
    ],
  },
  {
    title: '📊 Hoe lees je de prestatiemetrics?',
    steps: [
      'Klik op het 📊 icoon rechtsboven om de prestatielade te openen.',
      'Kies de periode: Vandaag, Deze week of Deze maand.',
      'Verwerkt = leads die jouw MQL-fase hebben verlaten in die periode.',
      'SQL = leads die doorstroomden naar Sales Qualified Lead.',
      'Lost = leads die zijn gecategoriseerd als verloren.',
    ],
  },
  {
    title: '🛠 Hoe maak je een playbook? (Admin)',
    adminOnly: true,
    steps: [
      'Ga naar Admin via de knop rechtsboven (alleen zichtbaar voor admins).',
      'Klik op "Nieuw playbook" en geef het een naam.',
      'Voeg fases toe met de "+ Fase" knop en geef elke fase een titel.',
      'Voeg per fase vragen toe — dit zijn ja/nee-vragen die reps tijdens het gesprek beantwoorden.',
      'Sla op — de wijzigingen zijn direct zichtbaar voor alle gebruikers.',
    ],
  },
  {
    title: '🗓 Hoe koppel je een planner? (Admin)',
    adminOnly: true,
    steps: [
      'Open een lead en klik op "Schedule Videocall" onderin.',
      'Vul in het schedulervenster de Calendly- of kalenderlink in via de admin-instelling.',
      'De link wordt weergegeven aan alle reps in het schedulervenster.',
      'Reps kunnen de link kopiëren of direct openen om een afspraak in te plannen.',
    ],
  },
]

const SECTIONS_EN: Section[] = [
  {
    title: '📥 How does requesting leads work?',
    steps: [
      'Click the "Request leads" button at the bottom of the dashboard.',
      'There is a 2-hour cooldown between requests — this ensures fair distribution.',
      'Leads are assigned based on availability in the MQL stage.',
      'After requesting, new leads appear in the table immediately.',
    ],
  },
  {
    title: '📞 How do you set the call outcome?',
    steps: [
      'Open a lead by clicking it in the table.',
      'At the bottom of the modal you\'ll see three buttons: Home Visit, Schedule Videocall, Lost.',
      'Click the outcome that best matches the conversation.',
      'The outcome is saved to HubSpot immediately.',
    ],
  },
  {
    title: '📝 How do you fill in the playbook?',
    steps: [
      'Open a lead — the playbook appears on the right if a product is selected.',
      'Navigate through phases step by step using the left/right arrows.',
      'Answer the questions and add notes per step.',
      'Answers are saved automatically per lead.',
    ],
  },
  {
    title: '📊 How do you read the performance metrics?',
    steps: [
      'Click the 📊 icon in the top right to open the performance drawer.',
      'Select a period: Today, This week, or This month.',
      'Processed = leads that exited your MQL stage in that period.',
      'SQL = leads that progressed to Sales Qualified Lead.',
      'Lost = leads that were categorised as lost.',
    ],
  },
  {
    title: '🛠 How do you create a playbook? (Admin)',
    adminOnly: true,
    steps: [
      'Go to Admin via the button in the top right (only visible to admins).',
      'Click "New playbook" and give it a name.',
      'Add phases with the "+ Phase" button and give each a title.',
      'Add questions per phase — these are yes/no questions reps answer during the call.',
      'Save — changes are immediately visible to all users.',
    ],
  },
  {
    title: '🗓 How do you connect a scheduler? (Admin)',
    adminOnly: true,
    steps: [
      'Open a lead and click "Schedule Videocall" at the bottom.',
      'In the scheduler window, set the Calendly or calendar link via the admin setting.',
      'The link is shown to all reps in the scheduler window.',
      'Reps can copy or open the link directly to book an appointment.',
    ],
  },
]

export default function HelpModal() {
  const { state, setState } = useApp()
  const lang = state.lang
  const sections = lang === 'nl' ? SECTIONS_NL : SECTIONS_EN
  const isAdmin = state.isAdmin

  if (!state.helpOpen) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={() => setState({ helpOpen: false })}
    >
      <div
        style={{
          background: 'var(--bg)', borderRadius: 16, width: 560, maxWidth: '95vw',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 40px rgba(0,0,0,.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px 12px', borderBottom: '1px solid var(--gl)' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', flex: 1 }}>
            {lang === 'nl' ? 'Gebruikershandleiding' : 'User Guide'}
          </span>
          <button
            onClick={() => setState({ helpOpen: false })}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--cs)', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
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
      </div>
    </div>
  )
}
