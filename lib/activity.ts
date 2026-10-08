// Active time in the tool, for Admin → Team performance.
//
// A minute counts as active when the tool is the visible tab and the user
// clicked, typed, scrolled or moved the mouse in the last 5 minutes. Active
// minutes are collected here and sent to /api/activity every few minutes (and
// when the tab is hidden). The server keeps them only for members of the Team
// performance team; for anyone else it answers { tracked: false } and this stops.
// Minutes are stored as bits, so two open tabs never count the same minute twice.

import { apiFetch } from './auth'

const IDLE_MS = 5 * 60 * 1000
const TICK_MS = 20 * 1000      // < 60s, so every active minute gets seen at least once
const FLUSH_MS = 5 * 60 * 1000
const MAX_PENDING = 2000
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/** Starts tracking for the signed-in user. Returns a function that flushes and stops it. */
export function startActivityTracker(): () => void {
  if (typeof window === 'undefined') return () => {}

  let lastInput = Date.now() // signing in is activity
  let stopped = false
  let flushing = false
  const pending = new Set<number>()

  const onInput = () => { lastInput = Date.now() }

  function tick() {
    const now = Date.now()
    if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS && pending.size < MAX_PENDING) {
      pending.add(Math.floor(now / 60000))
    }
  }

  async function flush(keepalive = false) {
    if (stopped || flushing || pending.size === 0) return
    const minutes = Array.from(pending)
    flushing = true
    try {
      const res = await apiFetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
        keepalive,
      })
      if (!res.ok) return // keep the minutes, try again next flush
      minutes.forEach(m => pending.delete(m))
      const data = await res.json().catch(() => ({}))
      if (data?.tracked === false) stop()
    } catch {
      // offline or page unloading: keep the minutes for the next flush
    } finally {
      flushing = false
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') flush(true)
    else tick()
  }

  INPUT_EVENTS.forEach(e => window.addEventListener(e, onInput, { passive: true, capture: true }))
  document.addEventListener('visibilitychange', onVisibility)
  const tickTimer = window.setInterval(tick, TICK_MS)
  const flushTimer = window.setInterval(() => flush(), FLUSH_MS)

  function stop() {
    if (stopped) return
    stopped = true
    window.clearInterval(tickTimer)
    window.clearInterval(flushTimer)
    INPUT_EVENTS.forEach(e => window.removeEventListener(e, onInput, { capture: true }))
    document.removeEventListener('visibilitychange', onVisibility)
  }

  // First send right away: it also tells us whether this user is tracked at all
  tick()
  flush()

  return () => { flush(true); stop() }
}
