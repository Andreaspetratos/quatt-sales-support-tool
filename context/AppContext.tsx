'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import type { AppState, Deal, Lang, Modal, PerfData, PlaybookState, Task, TaskTab } from '@/lib/types'

// ── Default playbook state factory ────────────────────────────────────────────
export function defaultPbState(): PlaybookState {
  return { phaseIdx: 0, answers: {}, notes: {}, callOutcome: '', callOutcomeNote: '' }
}

// ── Initial app state ─────────────────────────────────────────────────────────
const initialState: AppState = {
  screen: 'login',
  lang: 'nl',
  currentRep: null,
  userAvatar: null,
  deals: [],
  selectedId: null,
  loading: false,
  cooldownEnd: null,
  playbook: {},
  modal: null,
  modalDealId: null,
  lostReason: '',
  lostNote: '',
  dmX: null,
  dmY: null,
  dmW: null,
  dmH: null,
  perfOpen: false,
  perfPeriod: 'today',
  perfData: null,
  perfLoading: false,
  taskTab: 'leads',
  taskModal: null,
  taskDraft: {},
}

// ── Context type ──────────────────────────────────────────────────────────────
interface AppContextValue {
  state: AppState
  // Generic partial update — merges shallowly into state
  setState: (partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void
  // Playbook helpers
  getPbState: (dealId: string) => PlaybookState
  setPbAnswer: (dealId: string, key: string, value: string) => void
  setPbNote: (dealId: string, key: string, value: string) => void
  setPhase: (dealId: string, idx: number) => void
  setActivePb: (dealId: string, key: string) => void
  donePhase: (dealId: string, phaseId: string, nextIdx: number) => void
  setCallOutcome: (dealId: string, value: string) => void
  setCallOutcomeNote: (dealId: string, value: string) => void
  // Deal helpers
  patchDealLocal: (id: string, props: Record<string, string>) => void
  selectDeal: (id: string | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<AppState>(initialState)

  const setState = useCallback(
    (partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
      setStateRaw(prev => ({
        ...prev,
        ...(typeof partial === 'function' ? partial(prev) : partial),
      }))
    },
    [],
  )

  // ── Playbook state helpers ─────────────────────────────────────────────────
  const getPbState = useCallback(
    (dealId: string): PlaybookState =>
      state.playbook[dealId] || defaultPbState(),
    [state.playbook],
  )

  const ensurePb = useCallback(
    (prev: AppState, dealId: string): PlaybookState =>
      prev.playbook[dealId] || defaultPbState(),
    [],
  )

  const setPbAnswer = useCallback((dealId: string, key: string, value: string) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      const cur = pb.answers[key]
      return {
        ...prev,
        playbook: {
          ...prev.playbook,
          [dealId]: {
            ...pb,
            answers: { ...pb.answers, [key]: cur === value ? '' : value },
          },
        },
      }
    })
  }, [ensurePb])

  const setPbNote = useCallback((dealId: string, key: string, value: string) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: {
          ...prev.playbook,
          [dealId]: { ...pb, notes: { ...pb.notes, [key]: value } },
        },
      }
    })
  }, [ensurePb])

  const setPhase = useCallback((dealId: string, idx: number) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: { ...prev.playbook, [dealId]: { ...pb, phaseIdx: idx } },
      }
    })
  }, [ensurePb])

  const setActivePb = useCallback((dealId: string, key: string) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: { ...prev.playbook, [dealId]: { ...pb, activePbKey: key, phaseIdx: 0 } },
      }
    })
  }, [ensurePb])

  const donePhase = useCallback((dealId: string, phaseId: string, nextIdx: number) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: {
          ...prev.playbook,
          [dealId]: {
            ...pb,
            phaseIdx: nextIdx,
            answers: { ...pb.answers, [phaseId + '_done']: 'true' },
          },
        },
      }
    })
  }, [ensurePb])

  const setCallOutcome = useCallback((dealId: string, value: string) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: {
          ...prev.playbook,
          [dealId]: {
            ...pb,
            callOutcome: pb.callOutcome === value ? '' : value,
          },
        },
      }
    })
  }, [ensurePb])

  const setCallOutcomeNote = useCallback((dealId: string, value: string) => {
    setStateRaw(prev => {
      const pb = ensurePb(prev, dealId)
      return {
        ...prev,
        playbook: {
          ...prev.playbook,
          [dealId]: { ...pb, callOutcomeNote: value },
        },
      }
    })
  }, [ensurePb])

  // ── Deal helpers ───────────────────────────────────────────────────────────
  const patchDealLocal = useCallback((id: string, props: Record<string, string>) => {
    setStateRaw(prev => ({
      ...prev,
      deals: prev.deals.map(d =>
        d.id === id ? { ...d, properties: { ...d.properties, ...props } } : d
      ),
    }))
  }, [])

  const selectDeal = useCallback((id: string | null) => {
    setStateRaw(prev => {
      const next: Partial<AppState> = { selectedId: id }
      if (id && !prev.playbook[id]) {
        next.playbook = { ...prev.playbook, [id]: defaultPbState() }
      }
      return { ...prev, ...next }
    })
  }, [])

  return (
    <AppContext.Provider
      value={{
        state,
        setState,
        getPbState,
        setPbAnswer,
        setPbNote,
        setPhase,
        setActivePb,
        donePhase,
        setCallOutcome,
        setCallOutcomeNote,
        patchDealLocal,
        selectDeal,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
