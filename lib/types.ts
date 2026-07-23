// ─── Core domain types ────────────────────────────────────────────────────────

export interface Rep {
  name: string
  email: string
  hubspotUserId: string
  hubspotOwnerId: string
}

export interface Deal {
  id: string
  properties: Record<string, string>
}

// Lead = same shape, used for HubSpot Leads object
export type Lead = Deal

export interface TechCheckOutcome {
  condition: string
  result: string
  color?: string
  script?: string
}

export type QuestionType =
  | 'script'
  | 'info'
  | 'choice'
  | 'textarea'
  | 'intent'
  | 'address'
  | 'outcome'
  | 'tech_check'

export interface Question {
  id: string
  type: QuestionType
  label?: string
  content?: string
  options?: string[]
  hsProperty?: string
  hsValueMap?: Record<string, string>
  required?: boolean
  placeholder?: string
  // address / outcome
  prefix?: string
  altProdNote?: string
  // tech_check
  agentQuestion?: string
  chipKey?: string
  chipOptions?: string[]
  chipLabel?: string
  outcomes?: TechCheckOutcome[]
  // intent
  hotDesc?: string
  warmDesc?: string
  coldDesc?: string
}

export interface Phase {
  id: string
  label?: string
  questions: Question[]
}

export interface Playbook {
  id: string
  name: string
  isBuiltin?: boolean
  productMatches: string[]
  phases: Phase[]
}

export interface Scheduler {
  id: string
  name: string
  buttonLabel?: string
  url: string
  productMatch?: string
  isDefault?: boolean
}

// ─── Playbook runtime state ───────────────────────────────────────────────────

export interface PlaybookState {
  phaseIdx: number
  answers: Record<string, string>
  notes: Record<string, string>
  callOutcome: string
  callOutcomeNote: string
  activePbKey?: string
}

// Which playbook def is active for a deal
export interface PlaybookInfo {
  type: 'custom'
  key: string
  def: Playbook
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  dealId: string | null
  assigneeEmail: string
  assigneeOwnerId?: string   // HubSpot owner ID of the assignee
  creatorEmail: string
  title: string
  note: string
  dueDate: string
  completed: boolean
  completedAt: string | null
  createdAt: string
  hsTaskId?: string
}

// ─── Performance ──────────────────────────────────────────────────────────────

export interface PerfPeriodData {
  total: number
  outcomes: Record<string, number>
}

export interface PerfData {
  today: PerfPeriodData
  week: PerfPeriodData
  month: PerfPeriodData
}

// ─── App-level enums ──────────────────────────────────────────────────────────

export type Lang = 'nl' | 'en'
export type Screen = 'login' | 'dashboard' | 'admin'
export type Modal = 'lost' | 'sched' | 'delPb' | 'delSch' | null
export type AdminTab = 'playbooks' | 'schedulers'
export type TaskTab = 'leads' | 'tasks'
export type PerfPeriod = 'today' | 'week' | 'month'

// ─── Full app state ───────────────────────────────────────────────────────────

export interface AppState {
  screen: Screen
  lang: Lang
  currentRep: Rep | null
  userAvatar: string | null
  leads: Lead[]
  selectedId: string | null
  loading: boolean
  cooldownEnd: number | null
  // keyed by deal id
  playbook: Record<string, PlaybookState>
  modal: Modal
  modalDealId: string | null
  lostReason: string
  lostNote: string
  // deal modal drag/resize (null = default centred)
  dmX: number | null
  dmY: number | null
  dmW: number | null
  dmH: number | null
  // performance drawer
  perfOpen: boolean
  perfPeriod: PerfPeriod
  perfData: PerfData | null
  perfLoading: boolean
  // task system
  taskTab: TaskTab
  taskModal: 'create' | null
  taskDraft: Partial<Task>
}
