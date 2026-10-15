'use client'

import { useEffect, useState } from 'react'

// Reps keep the tool open for days, and an open tab keeps running the build it
// loaded: on 2026-10-15 tabs from before a fix were still overwriting lead notes.
// Each build bakes in its id and publishes it as /version.json (next.config.mjs).
// When the deployed id differs from this tab's, ask the rep to reload. After the
// reload the ids match and the banner is gone.
//
// A new deployment doesn't reach every request at once: for a minute or so a
// reload can still get the previous version (on sandbox the banner first needed
// two reloads to clear). So a new id must stay live for SETTLE_MS, as seen by
// this tab, before the banner shows.
const THIS_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || ''
const CHECK_EVERY_MS = 5 * 60 * 1000
const SETTLE_MS = 2 * 60 * 1000

export default function UpdateBanner() {
  const [outdated, setOutdated] = useState(false)

  useEffect(() => {
    if (!THIS_BUILD) return
    let active = true
    let seen: { version: string; at: number } | null = null
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const { version } = await res.json()
        if (!active || !version) return
        if (version === THIS_BUILD) { seen = null; setOutdated(false); return }
        if (!seen || seen.version !== version) {
          seen = { version, at: Date.now() }
          clearTimeout(settleTimer)
          settleTimer = setTimeout(check, SETTLE_MS + 1000)
          return
        }
        if (Date.now() - seen.at >= SETTLE_MS) setOutdated(true)
      } catch { /* offline or mid-deploy: next check will tell */ }
    }
    function onVisible() { if (document.visibilityState === 'visible') check() }

    check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(settleTimer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!outdated) return null
  return (
    <div className="cfg-banner upd-banner" role="status">
      New version available! Please reload the page in order to get the new features.
    </div>
  )
}
