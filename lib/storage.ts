import type { Task, Playbook, Scheduler } from './types'
import { CONFIG } from './config'

// ── uid ────────────────────────────────────────────────────────────────────────
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ── Theme ──────────────────────────────────────────────────────────────────────
export function loadTheme(): string {
  try {
    return localStorage.getItem('quatt_theme') || 'light'
  } catch {
    return 'light'
  }
}

export function saveTheme(t: string): void {
  document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem('quatt_theme', t) } catch {}
}

// ── Language ───────────────────────────────────────────────────────────────────
export function loadLang(): 'nl' | 'en' {
  try {
    const saved = localStorage.getItem('quatt_lang')
    return (saved === 'en' ? 'en' : 'nl')
  } catch {
    return 'nl'
  }
}

export function saveLang(l: 'nl' | 'en'): void {
  try { localStorage.setItem('quatt_lang', l) } catch {}
}

// ── Playbooks ──────────────────────────────────────────────────────────────────
export function loadPbs(): Playbook[] {
  try {
    const r = localStorage.getItem('quatt_pbs')
    return r ? JSON.parse(r) : [...CONFIG.CUSTOM_PLAYBOOKS]
  } catch {
    return [...CONFIG.CUSTOM_PLAYBOOKS]
  }
}

export function savePbs(p: Playbook[]): void {
  try { localStorage.setItem('quatt_pbs', JSON.stringify(p)) } catch {}
}

// ── Schedulers ─────────────────────────────────────────────────────────────────
export function loadScheds(): Scheduler[] {
  try {
    const r = localStorage.getItem('quatt_schs')
    return r ? JSON.parse(r) : [...CONFIG.CUSTOM_SCHEDULERS]
  } catch {
    return [...CONFIG.CUSTOM_SCHEDULERS]
  }
}

export function saveScheds(s: Scheduler[]): void {
  try { localStorage.setItem('quatt_schs', JSON.stringify(s)) } catch {}
}

// ── Tasks ──────────────────────────────────────────────────────────────────────
export function loadTasks(): Task[] {
  try {
    const r = localStorage.getItem('quatt_tasks')
    return r ? JSON.parse(r) : []
  } catch {
    return []
  }
}

export function saveTasks(arr: Task[]): void {
  try { localStorage.setItem('quatt_tasks', JSON.stringify(arr)) } catch {}
}

export function myOpenTasks(email: string | undefined): Task[] {
  if (!email) return []
  return loadTasks().filter(t => !t.completed && t.assigneeEmail === email)
}

export function dealOpenTasks(dealId: string): Task[] {
  return loadTasks().filter(t => !t.completed && t.dealId === dealId)
}

export function createTask(draft: Partial<Task>): void {
  const tasks = loadTasks()
  tasks.push({
    id: uid(),
    dealId: draft.dealId || null,
    assigneeEmail: draft.assigneeEmail || '',
    creatorEmail: draft.creatorEmail || '',
    title: draft.title || '',
    note: draft.note || '',
    dueDate: draft.dueDate || '',
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString(),
  })
  saveTasks(tasks)
}

export function completeTask(id: string): void {
  const tasks = loadTasks()
  const t = tasks.find(x => x.id === id)
  if (t) { t.completed = true; t.completedAt = new Date().toISOString() }
  saveTasks(tasks)
}

export function deleteTask(id: string): void {
  saveTasks(loadTasks().filter(t => t.id !== id))
}
