'use client'

// Deals a TAM is already working on for this lead's customer. Reps booked a
// new lead with one TAM while the customer already had a deal in progress (or
// an appointment) with another, and the customer wants one person for all
// products. The lead modal shows these deals in a banner, and Plan HV / Plan
// Call ask to confirm first. Rules are in fetchActiveTamDeals (Andreas,
// 2026-10-22).

import { useEffect, useState } from 'react'
import { translate } from '@/lib/i18n'
import { fetchActiveTamDeals } from '@/lib/hubspot'
import type { ActiveTamDeal } from '@/lib/hubspot'
import type { Lang } from '@/lib/types'
import { productLabels, showProduct, useOwnerNames } from './OtherLeads'

type T = (k: string, ...a: any[]) => string

export type ActiveTamCheck =
  | { status: 'off' | 'loading' | 'error' }
  | { status: 'done'; deals: ActiveTamDeal[] }

export interface ActiveTam {
  check: ActiveTamCheck
  /** Owner id -> name; missing while loading, or when HubSpot doesn't know them. */
  owners: Record<string, string>
  labels: Record<string, string>
}

/** Checked once when the lead opens. `enabled` is false for SQL leads. */
export function useActiveTamDeals(leadId: string | null, contactId: string, enabled: boolean): ActiveTam {
  // Tagged with the lead it was loaded for, so switching to another lead
  // (e.g. after Claim) never shows, or asks about, the previous lead's deals.
  const [result, setResult] = useState<{ leadId: string; check: ActiveTamCheck } | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!leadId || !enabled) return
    let stale = false
    fetchActiveTamDeals(leadId, contactId || undefined)
      .then(deals => { if (!stale) setResult({ leadId, check: { status: 'done', deals } }) })
      .catch(e => {
        console.error('[hs] active TAM deal check failed:', leadId, e)
        if (!stale) setResult({ leadId, check: { status: 'error' } })
      })
    return () => { stale = true }
  }, [leadId, contactId, enabled])
  const check: ActiveTamCheck = !leadId || !enabled ? { status: 'off' }
    : result?.leadId === leadId ? result.check : { status: 'loading' }

  const deals = check.status === 'done' ? check.deals : []
  const owners = useOwnerNames(deals.map(d => d.ownerId))
  useEffect(() => { if (deals.length) productLabels().then(setLabels) }, [deals.length])
  return { check, owners, labels }
}

function ownerName(ownerId: string, owners: Record<string, string>): string {
  return owners[ownerId] || `#${ownerId}`
}

function tamNames(deals: ActiveTamDeal[], owners: Record<string, string>): string {
  return Array.from(new Set(deals.map(d => ownerName(d.ownerId, owners)))).join(', ')
}

/**
 * Before Plan HV / Plan Call: true when the rep should be asked first. A check
 * that is still loading or failed doesn't block booking.
 */
export function hasActiveTamDeals({ check }: ActiveTam): boolean {
  return check.status === 'done' && check.deals.length > 0
}

/** One row per deal: TAM, product and stage, with a link to the deal. */
function DealRows({ tam, portalId, t }: { tam: ActiveTam; portalId: string | null; t: T }) {
  const { check, owners, labels } = tam
  if (check.status !== 'done') return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {check.deals.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ct)' }}>
              {t('atdTam')}: {ownerName(d.ownerId, owners)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--cs)' }}>
              {t('atdProduct')}: {showProduct(d.product, labels)} · {t('atdStage')}: {d.stage || '--'}
            </div>
          </div>
          {portalId && (
            <a
              className="btn btn-sc btn-xs"
              href={`https://app-eu1.hubspot.com/contacts/${portalId}/record/0-3/${d.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {t('atdOpen')}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

export function ActiveTamDealsBanner({ tam, portalId, lang }: { tam: ActiveTam; portalId: string | null; lang: Lang }) {
  const t: T = (k, ...a) => translate(lang, k, ...a)
  const { check, owners } = tam

  if (check.status === 'error') {
    return <div style={{ fontSize: 12, color: 'var(--cs)', marginBottom: 12 }}>{t('atdFailed')}</div>
  }
  if (check.status !== 'done' || !check.deals.length) return null

  return (
    <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, background: 'rgba(247,102,34,0.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--or)', marginBottom: 6 }}>
        ⚠ {t('atdTitle')}
      </div>
      <div style={{ marginBottom: 6 }}>
        <DealRows tam={tam} portalId={portalId} t={t} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--ct)' }}>
        {t('atdBody', tamNames(check.deals, owners))}
      </div>
    </div>
  )
}

/**
 * Asked before Plan HV / Plan Call when the customer has an active TAM deal.
 * Same popup style as Lost and Long Term (.mb / .mo); it sits above the lead
 * modal. Closing it any way (✕, Cancel, a click outside) books nothing.
 */
export function ActiveTamConfirmModal({ tam, portalId, lang, onCancel, onContinue }: {
  tam: ActiveTam
  portalId: string | null
  lang: Lang
  onCancel: () => void
  onContinue: () => void
}) {
  const t: T = (k, ...a) => translate(lang, k, ...a)
  const { check, owners } = tam
  if (check.status !== 'done' || !check.deals.length) return null

  return (
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="mo" style={{ maxWidth: 460 }}>
        <div className="moh">
          <div className="mot">{t('atdConfirmTitle')}</div>
          <button className="xb" onClick={onCancel}>✕</button>
        </div>
        <div className="mob">
          <div style={{ fontSize: 13, color: 'var(--ct)' }}>
            {t('atdConfirmIntro', tamNames(check.deals, owners))}
          </div>
          <div style={{ border: '1px solid var(--or)', borderRadius: 6, padding: '8px 10px', background: 'rgba(247,102,34,0.10)' }}>
            <DealRows tam={tam} portalId={portalId} t={t} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ct)' }}>
            {t('atdConfirmQ')}
          </div>
        </div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={onCancel}>{t('cancel')}</button>
          <button className="btn btn-pr btn-sm" onClick={onContinue}>{t('atdContinue')}</button>
        </div>
      </div>
    </div>
  )
}
