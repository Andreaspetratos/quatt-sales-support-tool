'use client'

import { useEffect } from 'react'
import { AppProvider, useApp } from '@/context/AppContext'
import { seedBuiltinPlaybooks } from '@/lib/playbooks'
import { initAircallCTI } from '@/lib/hubspot'
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

  // Check server-side session on mount — auto-login if cookie is valid
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/auth/me')
        if (!res.ok) return
        const data = await res.json() as {
          authenticated: boolean
          email?: string
          name?: string
          picture?: string
          role?: string
        }
        if (!data.authenticated || !data.email) return
        const rep = { name: data.name || data.email, email: data.email, hubspotUserId: '', hubspotOwnerId: '' }
        setState({ screen: 'dashboard', currentRep: rep, userAvatar: data.picture || null, loading: false })
      } catch {
        // No session — stay on login screen
      }
    }
    // Only check when on login screen (avoids re-checking on every render)
    if (screen === 'login') checkSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
