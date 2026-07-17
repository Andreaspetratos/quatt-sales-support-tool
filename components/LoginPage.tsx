'use client'

import { useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { translate, translateArr } from '@/lib/i18n'
import { saveLang } from '@/lib/storage'
import { CONFIG, isDemo, isGoogleConfigured } from '@/lib/config'
import { fetchDeals } from '@/lib/hubspot'
import { decodeJwt } from '@/lib/hubspot'
import { showToast } from './Toast'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: object) => void
          renderButton: (el: HTMLElement, opts: object) => void
        }
      }
    }
  }
}

export default function LoginPage() {
  const { state, setState } = useApp()
  const t = (key: string, ...args: any[]) => translate(state.lang, key, ...args)
  const noGoogle = !isGoogleConfigured() || isDemo()

  async function afterLogin(rep: typeof CONFIG.REPS[0], avatar: string | null) {
    setState({ screen: 'dashboard', currentRep: rep, userAvatar: avatar, loading: true })
    try {
      const deals = await fetchDeals(rep.hubspotOwnerId)
      setState({ deals, loading: false })
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
      setState({ deals: [], loading: false })
    }
  }

  function loginWithEmail(email: string, name: string, picture: string | null) {
    const domain = (email || '').toLowerCase().split('@')[1]
    if (domain !== 'quatt.io') {
      showToast(t('errDomain'), 'error')
      return
    }
    const rep = CONFIG.REPS.find(r => r.email.toLowerCase() === email.toLowerCase())
      || { name: name || email, email, hubspotUserId: '', hubspotOwnerId: '' }
    afterLogin(rep, picture)
  }

  function demoLogin() {
    const rep = CONFIG.REPS[0] || { name: 'Demo', email: 'demo@quatt.io', hubspotUserId: 'demo', hubspotOwnerId: 'demo' }
    afterLogin(rep, null)
  }

  function setLang(l: 'nl' | 'en') {
    saveLang(l)
    setState({ lang: l })
  }

  // Mount Google button after the GSI script loads
  useEffect(() => {
    if (noGoogle) return
    const timer = setTimeout(() => {
      if (!window.google) return
      window.google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: (res: { credential: string }) => {
          const u = decodeJwt(res.credential)
          if (!u) { showToast(t('errNoRep'), 'error'); return }
          loginWithEmail(u.email, u.name, u.picture)
        },
        auto_select: false,
      })
      const btn = document.getElementById('gBtn')
      if (btn) {
        window.google.accounts.id.renderButton(btn, {
          theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 320,
        })
      }
    }, 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lang])

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
          {/* Language toggle */}
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

        {noGoogle ? (
          <>
            <div style={{ background: 'var(--gl)', borderRadius: 10, padding: 12, fontSize: 12, color: 'var(--gd)' }}>
              <span className="dp">DEMO</span> {t('demoNote')}
            </div>
            <button className="btn btn-pr btn-lg btn-full" onClick={demoLogin}>
              {t('demoBtn')}
            </button>
          </>
        ) : (
          <div id="gBtn" />
        )}
      </div>
    </div>
  )
}
