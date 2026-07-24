'use client'

import { useEffect } from 'react'
import { AppProvider, useApp } from '@/context/AppContext'
import { seedBuiltinPlaybooks } from '@/lib/playbooks'
import { initAircallCTI, fetchPerformance } from '@/lib/hubspot'
import { fetchSharedPbs } from '@/lib/storage'
import { showToast } from './Toast'
import Toast from './Toast'
import Topbar from './Topbar'
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
