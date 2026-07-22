'use client'

import { useEffect, useRef } from 'react'
import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { saveLang } from '@/lib/storage'
import { isDemo, CONFIG } from '@/lib/config'
import { fetchLeads, lookupHubspotUserId, lookupHubspotOwnerId } from '@/lib/hubspot'
import { showToast } from './Toast'

const GOOGLE_CLIENT_ID = '389875784063-rg6aporjtdsb0trolriuqrp97d94rgi7.apps.googleusercontent.com'

export default function LoginPage() {
  const { state, setState } = useApp()
  const t = (key: string, ...args: any[]) => translate(state.lang, key, ...args)
  const demo = isDemo()

  // Keep a stable ref to the credential handler so the GSI callback always
  // calls the latest closure (lang, setState, etc.)
  const credentialHandlerRef = useRef<(response: { credential: string }) => void>(() => {})

  credentialHandlerRef.current = (response: { credential: string }) => {
    try {
      const parts = response.credential.split('.')
      if (parts.length !== 3) throw new Error('Invalid token')
      const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
      const payload = JSON.parse(payloadJson) as {
        email?: string
        name?: string
        picture?: string
      }
      const email = payload.email ?? ''
      const name = payload.name ?? email
      const picture = payload.picture ?? ''

      if (!email.endsWith('@quatt.io')) {
        showToast('Gebruik je @quatt.io Google account om in te loggen.', 'error')
        return
      }

      const repConfig = CONFIG.REPS.find(r => r.email === email)
      const rep = {
        name: repConfig?.name || name,
        email,
        hubspotUserId: repConfig?.hubspotUserId || '', // will be overridden by dynamic lookup
        hubspotOwnerId: '',  // always resolved dynamically — NEVER seeded from config
      }
      // Never use hardcoded owner ID — always resolve dynamically from HubSpot.
      // Chain: email → userId (Users API) → ownerId (Owners API) → leads
      // This is the only correct flow: owner ID and user ID are separate systems.
      setState({ screen: 'dashboard', currentRep: rep, userAvatar: picture || null, loading: true })

      lookupHubspotUserId(email)
        .then(userId => {
          if (userId) setState(prev => ({
            currentRep: prev.currentRep ? { ...prev.currentRep, hubspotUserId: userId } : prev.currentRep,
          }))
          return lookupHubspotOwnerId(email)
        })
        .then(async ownerId => {
          if (!ownerId) {
            showToast('Eigenaar niet gevonden in HubSpot — zie console voor details.', 'error')
            setState({ loading: false })
            return
          }
          setState(prev => ({
            currentRep: prev.currentRep ? { ...prev.currentRep, hubspotOwnerId: ownerId } : prev.currentRep,
          }))
          try {
            const leads = await fetchLeads(ownerId)
              setState({ leads, loading: false })
          } catch (e: any) {
            console.error('[login] fetchLeads error:', e)
            showToast(t('errLoad', e.message), 'error')
            setState({ leads: [], loading: false })
          }
        })
        .catch((e: any) => {
          console.error('[login] chain error:', e)
          showToast(t('errLoad', e.message), 'error')
          setState({ loading: false })
        })
    } catch {
      showToast('Inloggen mislukt, probeer opnieuw.', 'error')
    }
  }

  // Initialize GSI once when the script is ready — NOT inside the click handler
  useEffect(() => {
    function initGSI() {
      const w = window as any
      if (!w.google?.accounts?.id) return
      w.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: { credential: string }) => {
          credentialHandlerRef.current(response)
        },
        auto_select: false,
        use_fedcm_for_prompt: true, // opt-in to FedCM — silences deprecation warning
      })
    }

    // GSI might already be loaded (cached)
    if ((window as any).google?.accounts?.id) {
      initGSI()
    } else {
      // Wait for the async script to load
      const script = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      ) as HTMLScriptElement | null
      if (script) {
        script.addEventListener('load', initGSI)
        return () => script.removeEventListener('load', initGSI)
      }
    }
  }, [])

  function setLang(l: 'nl' | 'en') {
    saveLang(l)
    setState({ lang: l })
  }

  async function demoLogin() {
    const rep = { name: 'Demo', email: 'demo@quatt.io', hubspotUserId: 'demo', hubspotOwnerId: 'demo' }
    setState({ screen: 'dashboard', currentRep: rep, userAvatar: null, loading: true })
    try {
      const leads = await fetchLeads(rep.hubspotOwnerId)
      setState({ leads, loading: false })
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
      setState({ leads: [], loading: false })
    }
  }

  function signInWithGoogle() {
    const w = window as any
    if (!w.google?.accounts?.id) {
      showToast('Google Sign-In laadt nog, probeer opnieuw.', 'error')
      return
    }
    // prompt() only — initialize() already ran in useEffect
    // With FedCM the browser controls prompt display — just call prompt()
    w.google.accounts.id.prompt()
  }

  return (
    <div className="ls" style={{ flex: 1 }}>
      <div className="lc">
        {/* Logo + title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg height="26" viewBox="0 0 80 26" xmlns="http://www.w3.org/2000/svg">
            <text y="21.3" fontFamily="Plus Jakarta Sans,sans-serif" fontSize="26" fontWeight="700" fill="#F76622">Quatt</text>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gm)', letterSpacing: '1px', textTransform: 'uppercase' }}>
            {t('appTitle')}
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <div className="lt">
              <button className={`ltb ${state.lang === 'nl' ? 'on' : ''}`} onClick={() => setLang('nl')}>NL</button>
              <button className={`ltb ${state.lang === 'en' ? 'on' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
          </div>
        </div>

        <div>
          <div className="lt2">{t('loginTitle')}</div>
          <div className="ls2">{t('loginSub')}</div>
        </div>

        {demo ? (
          <>
            <div style={{ background: 'var(--gl)', borderRadius: 10, padding: 12, fontSize: 12, color: 'var(--gd)' }}>
              <span className="dp">DEMO</span> {t('demoNote')}
            </div>
            <button className="btn btn-pr btn-lg btn-full" onClick={demoLogin}>
              {t('demoBtn')}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-sc btn-lg btn-full"
              onClick={signInWithGoogle}
              style={{ gap: 10 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              {t('loginBtn')}
            </button>
            <div id="google-btn-container" style={{ display: 'flex', justifyContent: 'center' }} />
          </>
        )}
      </div>
    </div>
  )
}
