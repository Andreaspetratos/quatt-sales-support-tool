'use client'

// "Customer's deals": every Consumer Orders deal of the lead's customer, so a
// rep sees what the customer already has with Quatt (an installed product, a
// quote with a TAM, a lost deal) without opening HubSpot. Information only:
// nothing here writes to HubSpot, and there is no link to edit the deal
// (Andreas, 2026-11-12). The orange TAM banner at the top of the modal stays
// the warning for deals still in progress; this block is the full history.

import { useEffect, useState } from 'react'
import { translate } from '@/lib/i18n'
import { fetchCustomerDeals } from '@/lib/hubspot'
import type { CustomerDeal } from '@/lib/hubspot'
import type { Lang } from '@/lib/types'
import { olDate, productLabels, showProduct, useOwnerNames } from './OtherLeads'

type T = (k: string, ...a: any[]) => string

/**
 * Under "Customer's other leads". Loaded when the lead opens, so the heading
 * can show the count; collapsed by default like the blocks above it. The
 * count stays grey: this is background, not something to act on.
 */
export default function CustomerDeals({ contactId, leadId, lang }: { contactId: string; leadId: string; lang: Lang }) {
  const t: T = (k, ...a) => translate(lang, k, ...a)

  // Tagged with the lead it was loaded for, so a switch never shows the
  // previous customer's deals. deals null = the read failed.
  const [data, setData] = useState<{ leadId: string; deals: CustomerDeal[] | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    let stale = false
    fetchCustomerDeals(leadId, contactId)
      .then(deals => { if (!stale) setData({ leadId, deals }) })
      .catch(e => {
        console.error('[hs] customer deals failed:', leadId, e)
        if (!stale) setData({ leadId, deals: null })
      })
    return () => { stale = true }
  }, [contactId, leadId])

  const shown = data && data.leadId === leadId ? data.deals : undefined
  useEffect(() => { if (open) productLabels().then(setLabels) }, [open])
  const owners = useOwnerNames((shown || []).map(d => d.ownerId))

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div className="sl2">{t('cdTitle')}</div>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>
          {shown === undefined ? '…' : shown === null ? '(!)' : `(${shown.length})`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cs)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && shown === null && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('cdFailed')}</div>
      )}
      {open && shown && shown.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--cs)', padding: '6px 0' }}>{t('cdNone')}</div>
      )}
      {open && shown && shown.length > 0 && (
        <div className="cd-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {shown.map(d => (
            <div
              key={d.id}
              className="cd-row"
              style={{ border: '1px solid var(--cb)', borderRadius: 6, padding: '8px 10px', opacity: d.inactive ? 0.55 : 1 }}
            >
              <div
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--ct)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={d.name}
              >{d.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ct)', marginTop: 3 }}>
                {t('cdStage')}: <span style={{ fontWeight: 600 }}>{d.stage || '--'}</span>
                {d.stageEnteredAt && <> · {t('cdSince')} {olDate(d.stageEnteredAt)}</>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cs)', marginTop: 2 }}>
                {t('cdOwner')}: {d.ownerId ? (owners[d.ownerId] || `#${d.ownerId}`) : t('olUnassigned')}
                {' · '}{t('cdProduct')}: {showProduct(d.product, labels)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
