'use client'

import { useEffect, useRef, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  msg: string
  type: ToastType
}

// Singleton event bus so any component can fire toasts
type ToastListener = (msg: string, type: ToastType) => void
const listeners: ToastListener[] = []

export function showToast(msg: string, type: ToastType = 'info') {
  listeners.forEach(fn => fn(msg, type))
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  useEffect(() => {
    const fn: ToastListener = (msg, type) => {
      const id = ++counterRef.current
      setToasts(prev => [...prev, { id, msg, type }])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 3000)
    }
    listeners.push(fn)
    return () => {
      const idx = listeners.indexOf(fn)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }, [])

  if (!toasts.length) return null

  return (
    <div className="tc">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`tt ${t.type === 'success' ? 'ts' : t.type === 'error' ? 'te' : 'ti'}`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}
