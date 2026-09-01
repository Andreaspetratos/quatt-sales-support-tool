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
  // Agent-facing question types (used in custom playbooks):
  | 'open_text'        // free-text note → appended to personal_info___notes
  | 'list_options'     // pick ONE from list → appended to personal_info___notes
  | 'multi_select'     // pick MULTIPLE from list → appended to personal_info___notes
  | 'update_property'  // update a HubSpot deal property directly

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
  // update_property — stored at admin save time so agents need no extra API calls
  hubspotPropFieldType?: string   // 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox' | 'booleancheckbox'
  hubspotPropOptions?: Array<{ label: string; value: string }>
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
  productMatches?: string[]   // multi-select, same pattern as Playbook
  productMatch?: string        // legacy — kept for backward compat, ignored in new code
  isDefault?: boolean
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
export interface Feedback {
  id: string
  message: string
  submittedBy: string          // email of submitter
  submittedAt: string          // ISO timestamp
  triage?: string              // AI-generated triage comment
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
  processed: number   // leads that exited MQL in this period
  sql: number         // of those, now in SQL stage
  lost: number        // of those, now in Lost stage
}

export interface PerfData {
  today: PerfPeriodData
  week:  PerfPeriodData
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
  isAdmin: boolean
  playbooks: Playbook[]
  schedulers: Scheduler[]
  feedbacks: Feedback[]
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
  helpOpen: boolean
  hubspotPortalId: string | null
  dealLoading: boolean
  dealNotif: { id: string; name: string; hvSchedulerUrl: string | null; hvSchedulerLoading?: boolean } | null
  perfPeriod: PerfPeriod
  perfData: PerfData | null
  perfLoading: boolean
  // task system
  taskTab: TaskTab
  taskModal: 'create' | null
  taskDraft: Partial<Task>
}
