'use client'

import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { saveLang } from '@/lib/storage'
import { isDemo } from '@/lib/config'
import { fetchDeals } from '@/lib/hubspot'
import { showToast } from './Toast'

export default function LoginPage() {
  const { state, setState } = useApp()
  const t = (key: string, ...args: any[]) => translate(state.lang, key, ...args)
  const demo = isDemo()

  function setLang(l: 'nl' | 'en') {
    saveLang(l)
    setState({ lang: l })
  }

  async function demoLogin() {
    const rep = { name: 'Demo', email: 'demo@quatt.io', hubspotUserId: 'demo', hubspotOwnerId: 'demo' }
    setState({ screen: 'dashboard', currentRep: rep, userAvatar: null, loading: true })
    try {
      const deals = await fetchDeals(rep.hubspotOwnerId)
      setState({ deals, loading: false })
    } catch (e: any) {
      showToast(t('errLoad', e.message), 'error')
      setState({ deals: [], loading: false })
    }
  }

  function signInWithGoogle() {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.href = `/auth/login?next=${next}`
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
            {t('loginSub')}
          </button>
        )}
      </div>
    </div>
  )
}
