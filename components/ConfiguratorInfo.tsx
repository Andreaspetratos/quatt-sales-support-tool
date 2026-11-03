'use client'

// What the customer filled in on the website, in the lead modal, so a rep
// doesn't have to open HubSpot for it. The configurator, the savings check and
// the self-service quote all write it to personal_info__notes_lead.
// The tool appends to the same property (notepad blocks, and playbook answers
// as single lines straight under the existing text), so the configurator's part
// can't be cut out reliably: the block shows the whole value, read-only.

import { useEffect, useState } from 'react'
import { translate } from '@/lib/i18n'
import { fetchLeadNotes, onLeadWrite } from '@/lib/hubspot'
import type { Lang } from '@/lib/types'

// Header of a block the tool appended (collectAndSaveNotepads in DealModal)
const NOTE_STAMP = /^--- \d{2}-\d{2}-\d{4} \d{2}:\d{2} ---$/

/**
 * "Configurator & notes", above Recent activity. Loaded when the lead opens,
 * so the heading can say when there is nothing; collapsed by default like the
 * blocks under it. Read again after every write to this lead, since the tool
 * may just have appended to the notes.
 */
export default function ConfiguratorInfo({ leadId, lang }: { leadId: string; lang: Lang }) {
  const t = (k: string, ...a: any[]) => translate(lang, k, ...a)

  // Tagged with the lead it was loaded for, so a switch never shows the
  // previous lead's notes. text null = the read failed.
  const [data, setData] = useState<{ leadId: string; text: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let stale = false
    fetchLeadNotes(leadId)
      .then(text => { if (!stale) setData({ leadId, text }) })
      .catch(e => {
        console.error('[hs] lead notes failed:', leadId, e)
        if (!stale) setData({ leadId, text: null })
      })
    return () => { stale = true }
  }, [leadId, reload])

  useEffect(() => onLeadWrite(id => { if (id === leadId) setReload(n => n + 1) }), [leadId])

  const shown = data && data.leadId === leadId ? data.text : undefined
  // Blank lines between every item of the configurator's quote: one is enough
  const text = (shown || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="sl2">{t('cfgTitle')}</div>
        {!text && (
          <span style={{ fontSize: 11, color: 'var(--cs)' }}>
            {shown === undefined ? '…' : shown === null ? '(!)' : `(${t('cfgEmpty')})`}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && shown === null && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('cfgFailed')}</div>
      )}
      {open && shown !== undefined && shown !== null && !text && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('cfgNone')}</div>
      )}
      {open && text && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 6,
          background: 'var(--c2)', border: '1px solid var(--cb)',
          fontSize: 12, lineHeight: 1.45, color: 'var(--ct)', overflowWrap: 'anywhere',
        }}>
          {text.split('\n').map((line, i) => {
            const l = line.trim()
            if (!l) return <div key={i} style={{ height: 6 }} />
            // The tool's own blocks start here: set apart from the customer's quote
            if (NOTE_STAMP.test(l)) {
              return <div key={i} style={{ fontWeight: 700, color: 'var(--cs)', marginTop: i ? 6 : 0 }}>{l}</div>
            }
            return <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{line}</div>
          })}
        </div>
      )}
    </div>
  )
}
