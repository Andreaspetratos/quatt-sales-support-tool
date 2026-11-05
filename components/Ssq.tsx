'use client'

// Signed self-service quote (SSQ): the customer accepted the quote on the
// website before talking to us. Reps talk to these leads differently, so the
// board marks them with 📝 and the lead modal shows when and for which product.
//
// Source: the lead's own properties, loaded with every lead (LEAD_PROPS).
// - self_service_quote_accepted_lead: checkbox, 'true' when signed
// - self_service_quote_accepted_date: when it was signed (always set when the
//   checkbox is: checked on production 2026-11-05, 0 leads with one but not the other)
// - most_recent_selected_product_lead: the product. It is the customer's most
//   recent pick, so it can change if they configure again after signing.

import { translate } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

type Props = Record<string, string | null | undefined>

export function hasSignedSsq(p: Props | undefined): boolean {
  return p?.self_service_quote_accepted_lead === 'true'
}

/** "5 nov 10:22", with the year when it isn't this year. */
export function ssqDate(iso: string | null | undefined): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const day = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

/** HubSpot stores several products as "A;B". */
function productText(v: string | null | undefined): string {
  return v ? v.split(';').map(s => s.trim()).filter(Boolean).join(', ') : '--'
}

/** 📝 next to a lead's name on the board; hover shows the signing date. */
export function SsqIcon({ p, lang }: { p: Props | undefined; lang: Lang }) {
  if (!hasSignedSsq(p)) return null
  const hint = translate(lang, 'ssqIconHint', ssqDate(p?.self_service_quote_accepted_date))
  return (
    <span className="ssq-icon" title={hint} aria-label={hint} role="img">📝</span>
  )
}

/** Green block at the top of the lead modal's left column. */
export function SsqBlock({ p, lang }: { p: Props | undefined; lang: Lang }) {
  if (!hasSignedSsq(p)) return null
  const t = (k: string) => translate(lang, k)
  return (
    <div className="ssq-box">
      <div className="ssq-t">📝 {t('ssqTitle')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="kv">
          <span className="kk">{t('ssqDate')}</span>
          <span className="vv">{ssqDate(p?.self_service_quote_accepted_date)}</span>
        </div>
        <div className="kv">
          <span className="kk">{t('ssqProduct')}</span>
          <span className="vv">{productText(p?.most_recent_selected_product_lead)}</span>
        </div>
      </div>
    </div>
  )
}
