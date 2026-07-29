'use client'

import { useEffect } from 'react'
import { AppProvider, useApp } from '@/context/AppContext'
import { seedBuiltinPlaybooks } from '@/lib/playbooks'
import { initAircallCTI, fetchPerformance } from '@/lib/hubspot'
import { fetchSharedPbs } from '@/lib/storage'
import { showToast } from './Toast'
import Toast from './Toast'
import Topbar from './Topbar'
import HelpModal from './HelpModal'
import LoginPage from './LoginPage'
import PipelineBoard from './PipelineBoard'
import AdminPanel from './AdminPanel'

// ── Inner shell (inside AppProvider so it can use useApp) ─────────────────────
function Shell() {
  const { state, setState } = useApp()
  const { screen, currentRep, lang, perfOpen } = state

  function openPerf() { setState({ perfOpen: true }) }
  function closePerf() { setState({ perfOpen: false }) }

  // Seed built-in playbooks into localStorage once on mount
  useEffect(() => {
    try {
      seedBuiltinPlaybooks()
    } catch (e) {
      console.warn('[AppShell] seedBuiltinPlaybooks failed', e)
    }
  }, [])

  // Initialize Aircall CTI listener once we have a logged-in rep
  useEffect(() => {
    if (!currentRep) return
    const unsub = initAircallCTI((dealName, phone) => {
      // Handle inbound CTI events from the Aircall power dialer
      if (phone) {
        showToast(`Aircall: inkomend gesprek van ${phone}`, 'success')
      }
    })
    return unsub
  }, [currentRep?.email])

  // Pre-fetch performance data on login so the drawer is ready immediately
  useEffect(() => {
    if (!currentRep?.hubspotOwnerId) return
    setState({ perfLoading: true })
    fetchPerformance(currentRep.hubspotOwnerId)
      .then(data => setState({ perfData: data, perfLoading: false }))
      .catch(() => setState({ perfLoading: false }))
  }, [currentRep?.hubspotOwnerId])

  // Load shared playbooks from KV on mount (and whenever user logs in)
  useEffect(() => {
    fetchSharedPbs().then(pbs => {
      if (pbs.length > 0) setState({ playbooks: pbs })
    })
  }, [currentRep?.email])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--tx)',
      }}
    >
      {/* Global toast overlay */}
      <Toast />

      {/* Help modal — available from any screen */}
      <HelpModal />

      {/* Top navigation bar — hidden on login screen */}
      {screen !== 'login' && currentRep && (
        <Topbar perfOpen={perfOpen} onOpenPerf={openPerf} onClosePerf={closePerf} />
      )}

      {/* Main content area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {screen === 'login' && <LoginPage />}
        {screen === 'dashboard' && <PipelineBoard perfOpen={perfOpen} onOpenPerf={openPerf} onClosePerf={closePerf} />}
        {screen === 'admin' && <AdminPanel />}
      </main>

      {/* Deal booking overlay — rendered AFTER <main> so it's always on top in DOM order */}
      {state.dealLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 52, animation: 'dealSpin 1.6s ease-in-out infinite' }}>⏳</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
            {state.lang === 'nl' ? 'Afspraak boeken…' : 'Booking appointment…'}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
            {state.lang === 'nl' ? 'Deal wordt aangemaakt in HubSpot' : 'Deal is being created in HubSpot'}
          </div>
          <style>{`@keyframes dealSpin { 0%,100%{transform:rotate(-10deg)} 50%{transform:rotate(10deg)} }`}</style>
        </div>
      )}

      {/* Deal notification banner — shown after deal is found */}
      {state.dealNotif && !state.dealLoading && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg)', border: '2px solid var(--cp)',
          borderRadius: 14, padding: '18px 22px', zIndex: 9999,
          boxShadow: '0 6px 32px rgba(0,0,0,.28)', minWidth: 320, maxWidth: 500,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--cs)', marginBottom: 5 }}>
                {state.lang === 'nl' ? '🎉 Deal aangemaakt in Consumer Orders' : '🎉 Deal created in Consumer Orders'}
              </div>
              {/* Deal name — hyperlink to HubSpot if portal ID is known */}
              {state.hubspotPortalId ? (
                <a
                  href={`https://app-eu1.hubspot.com/contacts/${state.hubspotPortalId}/deals/${state.dealNotif.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 15, fontWeight: 700, color: 'var(--cp)', textDecoration: 'underline', display: 'block', marginBottom: state.dealNotif.hvSchedulerUrl ? 12 : 0 }}
                >
                  {state.dealNotif.name}
                </a>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx)', marginBottom: state.dealNotif.hvSchedulerUrl ? 12 : 0 }}>
                  {state.dealNotif.name}
                </div>
              )}
              {/* HV scheduler URL — always show value if present */}
              {state.dealNotif.hvSchedulerUrl && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--cs)', marginBottom: 4 }}>
                    {state.lang === 'nl' ? 'Home Visit planner:' : 'Home Visit scheduler:'}
                  </div>
                  {state.dealNotif.hvSchedulerUrl.startsWith('http') ? (
                    <a
                      href={state.dealNotif.hvSchedulerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontSize: 13, color: '#fff', background: 'var(--cp)',
                        padding: '7px 14px', borderRadius: 8, textDecoration: 'none', fontWeight: 600,
                      }}
                    >
                      🗓 {state.lang === 'nl' ? 'Open planner' : 'Open scheduler'}
                    </a>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--tx)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {state.dealNotif.hvSchedulerUrl}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setState({ dealNotif: null })}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cs)', fontSize: 20, lineHeight: 1, flexShrink: 0 }}
            >✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Exported AppShell — wraps with the context provider ──────────────────────
export default function AppShell() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
