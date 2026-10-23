'use client'

// A yes/no question in the tool's own popup style (.mb / .mo), the same look
// as Lost and Long Term. Andreas wants every prompt a rep sees in the tool's
// UI, never the browser's window.confirm (2026-10-23).
//
// Rendered into <body> through a portal. Inside the lead modal, the card's
// pop-in transform and .dm-body's container query would otherwise make the
// popup position against, and get clipped by, the lead modal instead of the
// window.

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Closing it any way (✕, Cancel, a click outside) only calls onCancel. */
export default function ConfirmModal({ title, children, cancelLabel, confirmLabel, onCancel, onConfirm }: {
  title: string
  children: ReactNode
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="mb" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="mo" style={{ maxWidth: 460 }}>
        <div className="moh">
          <div className="mot">{title}</div>
          <button className="xb" onClick={onCancel} style={{ flexShrink: 0, marginLeft: 10 }}>✕</button>
        </div>
        <div className="mob">{children}</div>
        <div className="mof">
          <button className="btn btn-sc btn-sm" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn btn-pr btn-sm" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
