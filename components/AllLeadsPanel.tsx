'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { stageLabel } from '@/lib/config'
import { searchAllLeads, fetchOwnerMap, fetchOneLead, SearchLeadsResult } from '@/lib/hubspot'
import type { Lead } from '@/lib/types'

export default function AllLeadsPanel() {
  const { state, setState } = useApp()
  const t = (k: string) => translate(state.lang, k)
  const lang = state.lang

  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [paging, setPaging] = useState<SearchLeadsResult['paging']>(null)
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>({})
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load owner map once
  useEffect(() => {
    fetchOwnerMap().then(setOwnerMap)
  }, [])

  async function doSearch(q: string, after?: string) {
    setError(null)
    if (!after) { setSearching(true); setLeads([]) }
    else setLoadingMore(true)
    try {
      const result = await searchAllLeads(q, after)
      setLeads(prev => after ? [...prev, ...result.leads] : result.leads)
      setPaging(result.paging)
    } catch (e: any) {
      setError(e.message || 'Search failed')
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }

  function handleSearch() { doSearch(query) }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') doSearch(query)
  }

  async function handleOpen(lead: Lead) {
    setOpeningId(lead.id)
    try {
      // Ensure lead is in global state.leads so DealModal can find it
      setState(prev => {
        const already = prev.leads.some(l => l.id === lead.id)
        return {
          leads: already ? prev.leads : [lead, ...prev.leads],
          selectedId: lead.id,
        }
      })
    } finally {
      setOpeningId(null)
    }
  }

  async function handleClaim(lead: Lead) {
    const ownerId = state.currentRep?.hubspotOwnerId
    if (!ownerId) return
    setClaimingId(lead.id)
    try {
      const res = await fetch('/api/hs-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'PATCH',
          path: `/crm/v3/objects/leads/${lead.id}`,
          body: { properties: { hubspot_owner_id: ownerId } },
        }),
      })
      if (!res.ok) throw new Error('Claim failed')
      // Update local list
      setLeads(prev => prev.map(l =>
        l.id === lead.id
          ? { ...l, properties: { ...l.properties, hubspot_owner_id: ownerId } }
          : l
      ))
    } catch (e: any) {
      setError(e.message || 'Claim failed')
    } finally {
      setClaimingId(null)
    }
  }

  const myOwnerId = state.currentRep?.hubspotOwnerId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--cb)',
        background: 'var(--bg)',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          className="inp"
          style={{ flex: 1, maxWidth: 400 }}
          placeholder={t('alSearchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          className="btn btn-pr btn-sm"
          onClick={handleSearch}
          disabled={searching}
        >
          {searching ? t('alSearching') : t('alSearchBtn')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 20px', background: '#c0392b', color: '#fff', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {leads.length === 0 && !searching && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--cs)', fontSize: 14 }}>
            {t('alNoResults')}
          </div>
        )}

        {leads.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--cb)' }}>
                <th style={thStyle}>Naam</th>
                <th style={thStyle}>{t('alStage')}</th>
                <th style={thStyle}>{t('alOwner')}</th>
                <th style={{ ...thStyle, width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => {
                const props = lead.properties
                const name = props.hs_lead_name || lead.id
                const stage = stageLabel(props.hs_pipeline_stage || '')
                const ownerId = props.hubspot_owner_id || ''
                const ownerName = ownerMap[ownerId] || ownerId || '—'
                const isMine = ownerId === myOwnerId
                const isClaimedByMe = ownerId === myOwnerId

                return (
                  <tr key={lead.id} style={{ borderBottom: '1px solid var(--cb)' }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{name}</span>
                      {props.city && (
                        <span style={{ fontSize: 12, color: 'var(--cs)', marginLeft: 8 }}>
                          {props.city}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 6, background: 'var(--c2)', color: 'var(--cs)',
                      }}>
                        {stage}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 13, color: isMine ? 'var(--or)' : 'var(--tx)' }}>
                        {ownerName}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {!isClaimedByMe && myOwnerId && (
                          <button
                            className="btn btn-sc btn-sm"
                            disabled={claimingId === lead.id}
                            onClick={() => handleClaim(lead)}
                          >
                            {claimingId === lead.id ? '…' : t('alClaim')}
                          </button>
                        )}
                        <button
                          className="btn btn-pr btn-sm"
                          disabled={openingId === lead.id}
                          onClick={() => handleOpen(lead)}
                        >
                          {openingId === lead.id ? '…' : t('alOpen')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Load more */}
        {paging?.next && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              className="btn btn-sc"
              disabled={loadingMore}
              onClick={() => doSearch(query, paging!.next!.after)}
            >
              {loadingMore ? '…' : t('alLoadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 12,
  fontWeight: 700, color: 'var(--cs)', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const tdStyle: React.CSSProperties = {
  padding: '12px 12px', fontSize: 14, verticalAlign: 'middle',
}
