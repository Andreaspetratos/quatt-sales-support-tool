'use client'

// "No access" screen: shown after Google sign-in when the person has a @quatt.io
// account but isn't in a Sales Support HubSpot team (lib/access.ts), and when
// someone is taken out of the team while signed in. The server refuses all their
// /api calls (functions/api/_middleware.js); this screen only explains why.

import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { saveLang } from '@/lib/storage'
import { clearAuthToken } from '@/lib/auth'

export default function AccessDenied() {
  const { state, setState } = useApp()
  const t = (key: string, ...args: any[]) => translate(state.lang, key, ...args)

  function setLang(l: 'nl' | 'en') {
    saveLang(l)
    setState({ lang: l })
  }

  function signInAgain() {
    clearAuthToken()
    setState({ screen: 'login', deniedEmail: null, currentRep: null, userAvatar: null, isAdmin: false, leads: [], loading: false })
  }

  return (
    <div className="ls" style={{ flex: 1 }}>
      <div className="lc" role="alert">
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
          <div className="lt2">⛔ {t('deniedTitle')}</div>
          <div style={{ fontSize: 14, color: 'var(--ct)', marginTop: 10, lineHeight: 1.5 }}>{t('deniedText')}</div>
        </div>

        {state.deniedEmail && (
          <div style={{ background: 'var(--c2)', border: '1px solid var(--cb)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--cs)' }}>
            {t('deniedAs')} <span style={{ color: 'var(--ct)', fontWeight: 600, wordBreak: 'break-all' }}>{state.deniedEmail}</span>
          </div>
        )}

        <div className="ls2" style={{ marginTop: 0, lineHeight: 1.5 }}>{t('deniedHint')}</div>

        <button className="btn btn-sc btn-lg btn-full" onClick={signInAgain}>
          {t('deniedOther')}
        </button>
      </div>
    </div>
  )
}
