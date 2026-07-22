'use client'

import { useApp } from '@/context/AppContext'
import { translate } from '@/lib/i18n'
import { saveTheme, saveLang } from '@/lib/storage'
import { isDemo } from '@/lib/config'
import { CONFIG } from '@/lib/config'

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

interface TopbarProps {
  perfOpen: boolean
  onOpenPerf: () => void
  onClosePerf: () => void
}

export default function Topbar({ perfOpen, onOpenPerf, onClosePerf }: TopbarProps) {
  const { state, setState } = useApp()
  const t = (key: string, ...args: any[]) => translate(state.lang, key, ...args)
  const demo = isDemo()

  function setLang(l: 'nl' | 'en') {
    saveLang(l)
    setState({ lang: l })
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme')
    saveTheme(current === 'light' ? 'dark' : 'light')
  }

  function handleLogout() {
    setState({ screen: 'login', currentRep: null, userAvatar: null, leads: [], selectedId: null })
  }

  function goAdmin() {
    setState({ screen: 'admin' })
  }

  function goBack() {
    setState({ screen: 'dashboard' })
  }

  const isAdmin = state.currentRep && CONFIG.ADMINS.includes(state.currentRep.email)
  const currentTheme = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme')
    : 'light'

  return (
    <>
      <div className="tb">
        <div className="tb-l">
          {/* Quatt wordmark */}
          <svg height="20" viewBox="0 0 80 20" xmlns="http://www.w3.org/2000/svg">
            <text y="16.4" fontFamily="Plus Jakarta Sans,sans-serif" fontSize="20" fontWeight="700" fill="#F76622">Quatt</text>
          </svg>
          <span className="tb-tag">{t('appTitle')}</span>
          {demo && <span className="dp">DEMO</span>}
          {state.screen === 'admin' && (
            <button
              className="btn btn-xs"
              style={{ color: 'var(--gm)', border: '1px solid var(--dk)', background: 'transparent' }}
              onClick={goBack}
            >
              {t('backToSales')}
            </button>
          )}
        </div>

        <div className="tb-r">
          {/* Language toggle */}
          <div className="lt">
            <button className={`ltb ${state.lang === 'nl' ? 'on' : ''}`} onClick={() => setLang('nl')}>NL</button>
            <button className={`ltb ${state.lang === 'en' ? 'on' : ''}`} onClick={() => setLang('en')}>EN</button>
          </div>

          {/* Theme toggle */}
          <button
            className="btn btn-xs"
            title="Toggle theme"
            style={{ color: 'var(--gm)', border: '1px solid var(--dk)', background: 'transparent', fontSize: '14px', padding: '4px 8px' }}
            onClick={toggleTheme}
          >
            {currentTheme === 'light' ? '🌙' : '☀️'}
          </button>

          {/* Performance button */}
          {state.screen === 'dashboard' && (
            <button
              className="btn btn-xs"
              style={perfOpen
                ? { background: 'var(--or)', color: '#fff', borderColor: 'var(--or)' }
                : { color: 'var(--gm)', border: '1px solid var(--dk)', background: 'transparent' }}
              onClick={perfOpen ? onClosePerf : onOpenPerf}
            >
              📊
            </button>
          )}

          {/* Admin button */}
          {isAdmin && (
            <button
              className={`btn btn-xs ${state.screen === 'admin' ? 'btn-pr' : 'btn-sc'}`}
              style={state.screen !== 'admin' ? { borderColor: 'var(--gm)', color: 'var(--gm)' } : {}}
              onClick={state.screen === 'admin' ? goBack : goAdmin}
            >
              {t('admin')}
            </button>
          )}

          {/* Rep chip */}
          {state.currentRep && (
            <div className="rep-chip">
              <div className="ava">
                {state.userAvatar
                  ? <img src={state.userAvatar} alt={initials(state.currentRep.name)} />
                  : initials(state.currentRep.name)}
              </div>
              <span className="rep-nm">{state.currentRep.name.split(' ')[0]}</span>
            </div>
          )}

          {/* Logout */}
          <button
            className="btn btn-xs"
            style={{ color: 'var(--gm)', border: '1px solid var(--dk)', background: 'transparent' }}
            onClick={handleLogout}
          >
            {t('logout')}
          </button>
        </div>
      </div>

      {demo && (
        <div className="cfg-banner">
          {t('cfgBanner')}
        </div>
      )}
    </>
  )
}
