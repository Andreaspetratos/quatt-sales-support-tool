'use client'
import { useState, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { showToast } from './Toast'
import { fetchLeadPropertyOptions, fetchOneLead } from '@/lib/hubspot'
import { CONFIG } from '@/lib/config'
import { translate } from '@/lib/i18n'

// ── Local types ────────────────────────────────────────────────────────────────
interface ContactResult {
  id: string
  firstname: string
  lastname: string
  email: string
  phone: string
  address: string
  city: string
  zip: string
}

type Step = 'type' | 'search' | 'contact-form' | 'lead-form' | 'creating'

// ── HubSpot proxy helper ───────────────────────────────────────────────────────
async function hsP(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch('/api/hs-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  })
}

// Fetch the correct numeric associationTypeId for Lead → Contact (primary).
// HubSpot requires this in the POST body when creating a Lead.
async function fetchLeadContactAssocTypeId(): Promise<number> {
  try {
    const res = await hsP('GET', '/crm/v4/associations/leads/contacts/labels')
    if (!res.ok) return 578 // fallback
    const data = await res.json()
    const results: Array<{ category: string; typeId: number; label?: string | null }> =
      data.results || []
    // Prefer the unlabeled (primary) association type
    const primary = results.find(r => !r.label) ?? results[0]
    return primary?.typeId ?? 578
  } catch {
    return 578
  }
}

async function searchContactsByField(
  query: string,
  field: 'phone' | 'email',
): Promise<ContactResult[]> {
  const operator = field === 'email' ? 'EQ' : 'CONTAINS_TOKEN'
  const filterGroups =
    field === 'phone'
      ? [
          { filters: [{ propertyName: 'phone', operator, value: query }] },
          { filters: [{ propertyName: 'mobilephone', operator, value: query }] },
        ]
      : [{ filters: [{ propertyName: 'email', operator, value: query }] }]

  const res = await hsP('POST', '/crm/v3/objects/contacts/search', {
    filterGroups,
    properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'city', 'zip'],
    limit: 10,
  })
  if (!res.ok) throw new Error('Search failed (HTTP ' + res.status + ')')
  const data = await res.json()
  return (data.results || []).map((r: { id: string; properties: Record<string, string> }) => ({
    id: r.id,
    firstname: r.properties?.firstname || '',
    lastname: r.properties?.lastname || '',
    email: r.properties?.email || '',
    phone: r.properties?.phone || '',
    address: r.properties?.address || '',
    city: r.properties?.city || '',
    zip: r.properties?.zip || '',
  }))
}

async function createHsContact(fields: {
  email: string
  firstname: string
  lastname: string
  phone: string
  ownerId: string
}): Promise<string> {
  const res = await hsP('POST', '/crm/v3/objects/contacts', {
    properties: {
      email: fields.email.trim(),
      firstname: fields.firstname.trim(),
      lastname: fields.lastname.trim(),
      phone: fields.phone.trim(),
      hubspot_owner_id: fields.ownerId,
    },
  })
  if (!res.ok) {
    const txt = await res.text()
    let msg = 'Contact creation failed'
    try { const d = JSON.parse(txt); if (d.message) msg = d.message } catch { /**/ }
    throw new Error(msg)
  }
  const data = await res.json()
  const contactId = String(data.id)

  // HubSpot ignores hs_marketable_status in the POST body — PATCH it separately.
  await hsP('PATCH', `/crm/v3/objects/contacts/${contactId}`, {
    properties: { hs_marketable_status: 'true' },
  })

  return contactId
}

async function subscribeContactToEmail(email: string): Promise<void> {
  // Best-effort. Fetch subscription definitions to find the marketing/commercial type.
  try {
    const defsRes = await hsP('GET', '/communication-preferences/v3/definitions')
    if (!defsRes.ok) return
    const defs = await defsRes.json()
    const subs: Array<{ id: string | number; name?: string; internalName?: string }> =
      defs.subscriptionDefinitions || []
    // Try to find a marketing/commercial subscription type
    const target =
      subs.find(s =>
        /(marketing|commercial|reclame|promotie)/i.test(s.name || s.internalName || ''),
      ) ?? subs.find(s => /(email|nieuwsbrief|newsletter)/i.test(s.name || s.internalName || ''))
      ?? subs[0]
    if (!target) return
    await hsP('POST', '/communication-preferences/v3/subscribe', {
      emailAddress: email,
      subscriptionId: String(target.id),
      legalBasis: 'LEGITIMATE_INTEREST_OTHER',
      legalBasisExplanation: 'Inbound call — klant heeft contact opgenomen met sales',
    })
  } catch {
    // Silently ignore — subscription must not block lead creation
  }
}

async function createHsLead(fields: {
  contactId: string
  name: string
  ownerId: string
  street: string
  houseNumber: string
  houseNumberSuffix: string
  postalCode: string
  city: string
  product: string
}): Promise<string> {
  // HubSpot date fields expect milliseconds at midnight local time
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Fetch the correct association type ID first — HubSpot requires the
  // LEAD_TO_PRIMARY_CONTACT association to be present in the creation request.
  const assocTypeId = await fetchLeadContactAssocTypeId()

  const res = await hsP('POST', '/crm/v3/objects/leads', {
    properties: {
      hs_pipeline: CONFIG.PIPELINE_ID,
      hs_pipeline_stage: CONFIG.STAGES.MQL,
      hs_lead_name: fields.name.trim(),
      hubspot_owner_id: fields.ownerId,
      most_recent_form_origin_lead: 'Inbound Call',
      screening_call_requested_at: String(today.getTime()),
      selected_product_lead_all_time: fields.product,
      street_lead: fields.street.trim(),
      house_number: fields.houseNumber.trim(),
      house_number_suffix: fields.houseNumberSuffix.trim(),
      postal_code: fields.postalCode.trim(),
      city: fields.city.trim(),
    },
    associations: [
      {
        to: { id: fields.contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: assocTypeId }],
      },
    ],
  })

  if (!res.ok) {
    const txt = await res.text()
    let msg = 'Lead creation failed'
    try { const d = JSON.parse(txt); if (d.message) msg = d.message } catch { /**/ }
    throw new Error(msg)
  }
  const data = await res.json()
  return String(data.id)
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function CreateLeadModal({ onClose }: { onClose: () => void }) {
  const { state, setState } = useApp()
  const lang = state.lang
  const t = (k: string) => translate(lang, k)
  const ownerId = state.currentRep?.hubspotOwnerId || ''

  const [step, setStep] = useState<Step>('type')
  const [contactType, setContactType] = useState<'existing' | 'new' | null>(null)

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchField, setSearchField] = useState<'phone' | 'email'>('phone')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ContactResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null)

  // ── New contact form ──────────────────────────────────────────────────────
  const [newFirstname, setNewFirstname] = useState('')
  const [newLastname, setNewLastname] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')

  // ── Lead form ─────────────────────────────────────────────────────────────
  const [leadStreet, setLeadStreet] = useState('')
  const [leadHouseNumber, setLeadHouseNumber] = useState('')
  const [leadHouseNumberSuffix, setLeadHouseNumberSuffix] = useState('')
  const [leadPostalCode, setLeadPostalCode] = useState('')
  const [leadCity, setLeadCity] = useState('')
  const [leadProduct, setLeadProduct] = useState('')
  const [productOptions, setProductOptions] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    fetchLeadPropertyOptions('selected_product_lead_all_time').then(setProductOptions)
  }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function prefillLeadFromContact(c: ContactResult) {
    if (c.address) setLeadStreet(c.address)
    if (c.city) setLeadCity(c.city)
    if (c.zip) setLeadPostalCode(c.zip)
  }

  async function handleSearch() {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    setSearched(false)
    setSearchResults([])
    try {
      const results = await searchContactsByField(q, searchField)
      setSearchResults(results)
      setSearched(true)
      if (results.length === 0) showToast(t('clNoResults'), 'error')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('clErrSearch'), 'error')
    } finally {
      setSearching(false)
    }
  }

  function selectContact(c: ContactResult) {
    setSelectedContact(c)
    prefillLeadFromContact(c)
    setStep('lead-form')
  }

  async function handleCreateLead() {
    setStep('creating')
    try {
      let contactId: string
      let contactName: string

      if (contactType === 'new') {
        contactId = await createHsContact({
          email: newEmail,
          firstname: newFirstname,
          lastname: newLastname,
          phone: newPhone,
          ownerId,
        })
        if (newEmail.trim()) await subscribeContactToEmail(newEmail.trim())
        contactName = `${newFirstname.trim()} ${newLastname.trim()}`.trim()
      } else {
        contactId = selectedContact!.id
        contactName = `${selectedContact!.firstname} ${selectedContact!.lastname}`.trim()
      }

      const leadId = await createHsLead({
        contactId,
        name: contactName,
        ownerId,
        street: leadStreet,
        houseNumber: leadHouseNumber,
        houseNumberSuffix: leadHouseNumberSuffix,
        postalCode: leadPostalCode,
        city: leadCity,
        product: leadProduct,
      })

      const newLead = await fetchOneLead(leadId)
      if (newLead) {
        setState({ leads: [newLead, ...state.leads], selectedId: leadId })
      }

      showToast(t('clSuccess'), 'success')
      onClose()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('clErrLead'), 'error')
      setStep('lead-form')
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function canProceedToLeadForm(): boolean {
    if (contactType === 'new') {
      return !!newFirstname.trim() && !!newLastname.trim() && !!(newEmail.trim() || newPhone.trim())
    }
    return !!selectedContact
  }

  function canCreateLead(): boolean {
    return !!(leadHouseNumber.trim() && leadPostalCode.trim() && leadProduct)
  }

  // ── Step title ────────────────────────────────────────────────────────────
  const stepTitles: Record<Step, string> = {
    type: t('clTitle'),
    search: t('clSearchTitle'),
    'contact-form': t('clNewContactTitle'),
    'lead-form': t('clLeadTitle'),
    creating: '',
  }

  function goBack() {
    if (step === 'search' || step === 'contact-form') setStep('type')
    else if (step === 'lead-form') setStep(contactType === 'existing' ? 'search' : 'contact-form')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="mb"
      onClick={e => { if (e.target === e.currentTarget && step !== 'creating') onClose() }}
    >
      <div className="mo" style={{ maxWidth: 500, width: '100%' }}>

        {/* Header */}
        <div className="moh">
          <div className="mot">{step === 'creating' ? '' : stepTitles[step]}</div>
          {step !== 'creating' && (
            <button className="xb" onClick={onClose}>✕</button>
          )}
        </div>

        {/* Body */}
        <div className="mob" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── type ── */}
          {step === 'type' && (
            <>
              <p style={{ color: 'var(--cs)', fontSize: 13, margin: 0 }}>
                {t('clContactQuestion')}
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <button
                  className="btn btn-sc"
                  style={{ flex: 1, padding: '10px 16px' }}
                  onClick={() => { setContactType('existing'); setStep('search') }}
                >
                  {t('clExistingContact')}
                </button>
                <button
                  className="btn btn-sc"
                  style={{ flex: 1, padding: '10px 16px' }}
                  onClick={() => { setContactType('new'); setStep('contact-form') }}
                >
                  {t('clNewContact')}
                </button>
              </div>
            </>
          )}

          {/* ── search ── */}
          {step === 'search' && (
            <>
              <div className="iw">
                <label className="il">{t('clSearchOn')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['phone', 'email'] as const).map(f => (
                    <button
                      key={f}
                      className={`chip${searchField === f ? ' on' : ''}`}
                      onClick={() => { setSearchField(f); setSearched(false); setSearchResults([]) }}
                    >
                      {f === 'phone' ? t('clSearchPhone') : t('clSearchEmail')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="iw">
                <label className="il">
                  {searchField === 'phone' ? t('clSearchPhone') : t('clSearchEmail')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="inp"
                    style={{ flex: 1 }}
                    type={searchField === 'email' ? 'email' : 'tel'}
                    placeholder={searchField === 'phone' ? t('clSearchPlaceholderPhone') : t('clSearchPlaceholderEmail')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                  <button
                    className="btn btn-pr btn-sm"
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                  >
                    {searching ? <div className="sp" /> : t('clSearchBtn')}
                  </button>
                </div>
              </div>

              {searched && searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label className="il">
                    {searchResults.length === 1 ? '1 resultaat' : `${searchResults.length} resultaten`}
                  </label>
                  {searchResults.map(c => (
                    <button
                      key={c.id}
                      onClick={() => selectContact(c)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                        padding: '10px 14px', background: 'var(--c2)',
                        border: '1px solid var(--cb)', borderRadius: 8,
                        cursor: 'pointer', textAlign: 'left', gap: 3,
                        color: 'var(--ct)', width: '100%',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {c.firstname} {c.lastname}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--cs)' }}>
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searched && searchResults.length === 0 && (
                <p style={{ color: 'var(--cs)', fontSize: 13, margin: 0 }}>{t('clSearchNone')}</p>
              )}
            </>
          )}

          {/* ── contact-form ── */}
          {step === 'contact-form' && (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">
                    {t('clFirstname')} <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input className="inp" autoFocus placeholder="Jan"
                    value={newFirstname} onChange={e => setNewFirstname(e.target.value)} />
                </div>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">
                    {t('clLastname')} <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input className="inp" placeholder="de Vries"
                    value={newLastname} onChange={e => setNewLastname(e.target.value)} />
                </div>
              </div>
              <div className="iw">
                <label className="il">{t('clEmail')}</label>
                <input className="inp" type="email" placeholder="jan@email.com"
                  value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </div>
              <div className="iw">
                <label className="il">{t('clPhone')}</label>
                <input className="inp" type="tel" placeholder="+31 6 12345678"
                  value={newPhone} onChange={e => setNewPhone(e.target.value)} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--cs)', margin: 0 }}>{t('clContactHint')}</p>
            </>
          )}

          {/* ── lead-form ── */}
          {step === 'lead-form' && (
            <>
              {/* Contact summary */}
              {(selectedContact || contactType === 'new') && (
                <div style={{
                  padding: '8px 12px', background: 'var(--c2)',
                  borderRadius: 8, fontSize: 13, color: 'var(--ct)',
                  border: '1px solid var(--cb)',
                }}>
                  <span style={{ fontWeight: 600 }}>
                    {selectedContact
                      ? `${selectedContact.firstname} ${selectedContact.lastname}`
                      : `${newFirstname} ${newLastname}`}
                  </span>
                  {(selectedContact?.email || newEmail) && (
                    <span style={{ color: 'var(--cs)' }}>
                      {' · '}{selectedContact?.email || newEmail}
                    </span>
                  )}
                </div>
              )}

              <label className="il">{t('clAddress')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="iw" style={{ flex: 3 }}>
                  <label className="il">{t('clStreet')}</label>
                  <input className="inp" placeholder="Hoofdstraat" autoFocus
                    value={leadStreet} onChange={e => setLeadStreet(e.target.value)} />
                </div>
                <div className="iw" style={{ flex: 2 }}>
                  <label className="il">
                    {t('clHouseNr')} <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input className="inp" placeholder="12"
                    value={leadHouseNumber} onChange={e => setLeadHouseNumber(e.target.value)} />
                </div>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">{t('clHouseSuffix')}</label>
                  <input className="inp" placeholder="A"
                    value={leadHouseNumberSuffix} onChange={e => setLeadHouseNumberSuffix(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="iw" style={{ flex: 2 }}>
                  <label className="il">
                    {t('clPostalCode')} <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input className="inp" placeholder="1234 AB"
                    value={leadPostalCode} onChange={e => setLeadPostalCode(e.target.value)} />
                </div>
                <div className="iw" style={{ flex: 3 }}>
                  <label className="il">{t('clCity')}</label>
                  <input className="inp" placeholder="Amsterdam"
                    value={leadCity} onChange={e => setLeadCity(e.target.value)} />
                </div>
              </div>

              <div className="iw">
                <label className="il">
                  {t('clProduct')} <span style={{ color: 'var(--or)' }}>*</span>
                </label>
                <select className="inp" value={leadProduct} onChange={e => setLeadProduct(e.target.value)}>
                  <option value="">{t('clProductPlaceholder')}</option>
                  {productOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* ── creating ── */}
          {step === 'creating' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '28px 0' }}>
              <div className="sp" style={{ width: 32, height: 32, borderWidth: 3 }} />
              <p style={{ color: 'var(--cs)', fontSize: 14, margin: 0 }}>
                {contactType === 'new' ? t('clCreatingContact') : t('clCreatingLead')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'type' && step !== 'creating' && (
          <div className="mof">
            <button className="btn btn-sc btn-sm" onClick={goBack}>
              {t('clBack')}
            </button>
            {step === 'lead-form' ? (
              <button className="btn btn-pr btn-sm" disabled={!canCreateLead()} onClick={handleCreateLead}>
                {t('clCreate')}
              </button>
            ) : step === 'contact-form' ? (
              <button className="btn btn-pr btn-sm" disabled={!canProceedToLeadForm()} onClick={() => setStep('lead-form')}>
                {t('clNext')}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
