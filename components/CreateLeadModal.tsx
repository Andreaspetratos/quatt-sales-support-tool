'use client'
import { useState, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { showToast } from './Toast'
import { fetchLeadPropertyOptions, fetchOneLead } from '@/lib/hubspot'
import { CONFIG } from '@/lib/config'

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

// ── HubSpot proxy helpers (not exported — internal to this modal) ───────────────
async function hsP(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch('/api/hs-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  })
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
  if (!res.ok) throw new Error('Zoekopdracht mislukt (HTTP ' + res.status + ')')
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
      hs_marketable_status: 'true',
    },
  })
  if (!res.ok) {
    const txt = await res.text()
    let msg = 'Contact aanmaken mislukt'
    try {
      const d = JSON.parse(txt)
      if (d.message) msg += ': ' + d.message
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data = await res.json()
  return String(data.id)
}

async function subscribeContactToEmail(email: string): Promise<void> {
  // Best-effort: fetch available subscription definitions and subscribe the
  // contact under the first marketing/commercial type we find.
  try {
    const defsRes = await hsP('GET', '/communication-preferences/v3/definitions')
    if (!defsRes.ok) return
    const defs = await defsRes.json()
    const subs: Array<{ id: string | number; name?: string }> =
      defs.subscriptionDefinitions || []
    const target =
      subs.find(s =>
        /(marketing|email|nieuwsbrief|newsletter|commercial)/i.test(s.name || ''),
      ) || subs[0]
    if (!target) return
    await hsP('POST', '/communication-preferences/v3/subscribe', {
      emailAddress: email,
      subscriptionId: String(target.id),
      legalBasis: 'LEGITIMATE_INTEREST_OTHER',
      legalBasisExplanation:
        'Inbound call — klant heeft contact opgenomen met sales',
    })
  } catch {
    // silently swallow — subscription must not block lead creation
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
  // HubSpot date fields expect milliseconds at midnight UTC
  const today = new Date()
  today.setHours(0, 0, 0, 0)

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
  })
  if (!res.ok) {
    const txt = await res.text()
    let msg = 'Lead aanmaken mislukt'
    try {
      const d = JSON.parse(txt)
      if (d.message) msg += ': ' + d.message
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  const data = await res.json()
  const leadId = String(data.id)

  // Associate lead with contact via the v4 default-association endpoint.
  // This does not require knowing the numeric association type ID.
  try {
    await hsP(
      'PUT',
      `/crm/v4/objects/leads/${leadId}/associations/default/contacts/${fields.contactId}`,
    )
  } catch {
    // best-effort — the lead was created; association can be done manually in HubSpot
  }

  return leadId
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function CreateLeadModal({ onClose }: { onClose: () => void }) {
  const { state, setState } = useApp()
  const ownerId = state.currentRep?.hubspotOwnerId || ''

  const [step, setStep] = useState<Step>('type')
  const [contactType, setContactType] = useState<'existing' | 'new' | null>(null)

  // ── Search state ─────────────────────────────────────────────────────────────
  const [searchField, setSearchField] = useState<'phone' | 'email'>('phone')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ContactResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null)

  // ── New contact form ─────────────────────────────────────────────────────────
  const [newFirstname, setNewFirstname] = useState('')
  const [newLastname, setNewLastname] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')

  // ── Lead form ────────────────────────────────────────────────────────────────
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

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function prefilLleadFromContact(c: ContactResult) {
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
      if (results.length === 0) showToast('Geen contacten gevonden', 'error')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Zoeken mislukt', 'error')
    } finally {
      setSearching(false)
    }
  }

  function selectContact(c: ContactResult) {
    setSelectedContact(c)
    prefilLleadFromContact(c)
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
        contactName =
          `${selectedContact!.firstname} ${selectedContact!.lastname}`.trim()
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

      // Fetch full lead and add it to the board
      const newLead = await fetchOneLead(leadId)
      if (newLead) {
        setState({ leads: [newLead, ...state.leads], selectedId: leadId })
      }

      showToast('✓ Lead aangemaakt', 'success')
      onClose()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Aanmaken mislukt', 'error')
      setStep('lead-form')
    }
  }

  // ── Validation guards ─────────────────────────────────────────────────────
  function canProceedToLeadForm(): boolean {
    if (contactType === 'new') {
      return (
        !!newFirstname.trim() &&
        !!newLastname.trim() &&
        !!(newEmail.trim() || newPhone.trim())
      )
    }
    return !!selectedContact
  }

  function canCreateLead(): boolean {
    return !!(leadHouseNumber.trim() && leadPostalCode.trim() && leadProduct)
  }

  // ── Step title ────────────────────────────────────────────────────────────
  const stepTitle: Record<Step, string> = {
    type: 'Nieuwe lead aanmaken',
    search: 'Bestaand contact zoeken',
    'contact-form': 'Nieuw contact aanmaken',
    'lead-form': 'Leadgegevens invullen',
    creating: 'Bezig met aanmaken…',
  }

  // ── Back navigation ────────────────────────────────────────────────────────
  function goBack() {
    if (step === 'search' || step === 'contact-form') setStep('type')
    else if (step === 'lead-form')
      setStep(contactType === 'existing' ? 'search' : 'contact-form')
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="mb"
      onClick={e => {
        if (e.target === e.currentTarget && step !== 'creating') onClose()
      }}
    >
      <div className="mo" style={{ maxWidth: 480, width: '100%' }}>
        {/* Header */}
        <div className="moh">
          <div className="mot">{stepTitle[step]}</div>
          {step !== 'creating' && (
            <button className="xb" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* Body */}
        <div className="mob">

          {/* ── type ── */}
          {step === 'type' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ color: 'var(--cs)', fontSize: 13, margin: 0 }}>
                Staat de beller al in HubSpot als contact?
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-sc"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setContactType('existing')
                    setStep('search')
                  }}
                >
                  Ja — bestaand contact
                </button>
                <button
                  className="btn btn-sc"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setContactType('new')
                    setStep('contact-form')
                  }}
                >
                  Nee — nieuw contact
                </button>
              </div>
            </div>
          )}

          {/* ── search ── */}
          {step === 'search' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="iw">
                <label className="il">Zoeken op</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['phone', 'email'] as const).map(f => (
                    <button
                      key={f}
                      className={`chip${searchField === f ? ' on' : ''}`}
                      onClick={() => {
                        setSearchField(f)
                        setSearched(false)
                        setSearchResults([])
                      }}
                    >
                      {f === 'phone' ? 'Telefoonnummer' : 'E-mail'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="iw">
                <label className="il">
                  {searchField === 'phone' ? 'Telefoonnummer' : 'E-mailadres'}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="inp"
                    style={{ flex: 1 }}
                    type={searchField === 'email' ? 'email' : 'tel'}
                    placeholder={
                      searchField === 'phone' ? '+31 6 12345678' : 'naam@email.com'
                    }
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
                    {searching ? <div className="sp" /> : 'Zoeken'}
                  </button>
                </div>
              </div>

              {searched && searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label className="il">
                    {searchResults.length === 1
                      ? '1 resultaat'
                      : `${searchResults.length} resultaten`}
                  </label>
                  {searchResults.map(c => (
                    <button
                      key={c.id}
                      onClick={() => selectContact(c)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '10px 14px',
                        background: 'var(--c2)',
                        border: '1px solid var(--cb)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                        gap: 3,
                        color: 'var(--ct)',
                        width: '100%',
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
                <p style={{ color: 'var(--cs)', fontSize: 13, margin: 0 }}>
                  Geen contacten gevonden. Probeer een ander nummer of e-mailadres.
                </p>
              )}
            </div>
          )}

          {/* ── contact-form ── */}
          {step === 'contact-form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">
                    Voornaam <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input
                    className="inp"
                    autoFocus
                    placeholder="Jan"
                    value={newFirstname}
                    onChange={e => setNewFirstname(e.target.value)}
                  />
                </div>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">
                    Achternaam <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input
                    className="inp"
                    placeholder="de Vries"
                    value={newLastname}
                    onChange={e => setNewLastname(e.target.value)}
                  />
                </div>
              </div>
              <div className="iw">
                <label className="il">E-mailadres</label>
                <input
                  className="inp"
                  type="email"
                  placeholder="jan@email.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                />
              </div>
              <div className="iw">
                <label className="il">Telefoonnummer</label>
                <input
                  className="inp"
                  type="tel"
                  placeholder="+31 6 12345678"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--cs)', margin: '4px 0 0' }}>
                Minimaal voornaam, achternaam en één van e-mail of telefoon.
              </p>
            </div>
          )}

          {/* ── lead-form ── */}
          {step === 'lead-form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Contact summary pill */}
              {selectedContact && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--c2)',
                    borderRadius: 8,
                    fontSize: 13,
                    color: 'var(--ct)',
                    border: '1px solid var(--cb)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {selectedContact.firstname} {selectedContact.lastname}
                  </span>
                  {selectedContact.email && (
                    <span style={{ color: 'var(--cs)' }}> · {selectedContact.email}</span>
                  )}
                </div>
              )}
              {contactType === 'new' && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--c2)',
                    borderRadius: 8,
                    fontSize: 13,
                    color: 'var(--ct)',
                    border: '1px solid var(--cb)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {newFirstname} {newLastname}
                  </span>
                  {newEmail && (
                    <span style={{ color: 'var(--cs)' }}> · {newEmail}</span>
                  )}
                </div>
              )}

              {/* Address */}
              <label className="il" style={{ marginTop: 4 }}>
                Adres
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="iw" style={{ flex: 3 }}>
                  <label className="il">Straat</label>
                  <input
                    className="inp"
                    placeholder="Hoofdstraat"
                    value={leadStreet}
                    onChange={e => setLeadStreet(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="iw" style={{ flex: 2 }}>
                  <label className="il">
                    Huisnr <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input
                    className="inp"
                    placeholder="12"
                    value={leadHouseNumber}
                    onChange={e => setLeadHouseNumber(e.target.value)}
                  />
                </div>
                <div className="iw" style={{ flex: 1 }}>
                  <label className="il">Toev.</label>
                  <input
                    className="inp"
                    placeholder="A"
                    value={leadHouseNumberSuffix}
                    onChange={e => setLeadHouseNumberSuffix(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="iw" style={{ flex: 2 }}>
                  <label className="il">
                    Postcode <span style={{ color: 'var(--or)' }}>*</span>
                  </label>
                  <input
                    className="inp"
                    placeholder="1234 AB"
                    value={leadPostalCode}
                    onChange={e => setLeadPostalCode(e.target.value)}
                  />
                </div>
                <div className="iw" style={{ flex: 3 }}>
                  <label className="il">Stad</label>
                  <input
                    className="inp"
                    placeholder="Amsterdam"
                    value={leadCity}
                    onChange={e => setLeadCity(e.target.value)}
                  />
                </div>
              </div>

              {/* Product */}
              <div className="iw">
                <label className="il">
                  Product <span style={{ color: 'var(--or)' }}>*</span>
                </label>
                <select
                  className="inp"
                  value={leadProduct}
                  onChange={e => setLeadProduct(e.target.value)}
                >
                  <option value="">-- Selecteer product --</option>
                  {productOptions.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── creating ── */}
          {step === 'creating' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                padding: '28px 0',
              }}
            >
              <div className="sp" style={{ width: 32, height: 32, borderWidth: 3 }} />
              <p style={{ color: 'var(--cs)', fontSize: 14, margin: 0 }}>
                {contactType === 'new'
                  ? 'Contact en lead aanmaken…'
                  : 'Lead aanmaken…'}
              </p>
            </div>
          )}
        </div>

        {/* Footer — hidden on type step and while creating */}
        {step !== 'type' && step !== 'creating' && (
          <div className="mof">
            <button className="btn btn-sc btn-sm" onClick={goBack}>
              ← Terug
            </button>
            {step === 'lead-form' ? (
              <button
                className="btn btn-pr btn-sm"
                disabled={!canCreateLead()}
                onClick={handleCreateLead}
              >
                Lead aanmaken
              </button>
            ) : (
              step === 'contact-form' && (
                <button
                  className="btn btn-pr btn-sm"
                  disabled={!canProceedToLeadForm()}
                  onClick={() => setStep('lead-form')}
                >
                  Volgende →
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
