import type { Rep, Playbook, Scheduler } from './types'

interface StageIds {
  HOME_VISIT: string
  LOST: string
  LONG_TERM: string
}

interface PropNames {
  leadScore: string
  product: string
  callOutcome: string
  formOrigin: string
  partner: string
  temp: string
  requestedAt: string
}

interface AppConfig {
  GOOGLE_CLIENT_ID: string
  MAKE_WEBHOOK_URL: string
  HUBSPOT_TOKEN: string
  CORS_PROXY: string
  SCHEDULER_URL: string
  STAGES: StageIds
  PROPS: PropNames
  REQUEST_COOLDOWN: number
  REPS: Rep[]
  ADMINS: string[]
  DEMO_MODE: boolean
  CUSTOM_PLAYBOOKS: Playbook[]
  CUSTOM_SCHEDULERS: Scheduler[]
}

export const CONFIG: AppConfig = {
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/YOUR_ID',
  HUBSPOT_TOKEN: 'pat-eu1-YOUR_TOKEN',
  CORS_PROXY: '',
  SCHEDULER_URL: '',
  STAGES: {
    HOME_VISIT: 'YOUR_HV_STAGE',
    LOST: 'YOUR_LOST_STAGE',
    LONG_TERM: 'YOUR_LT_STAGE',
  },
  PROPS: {
    leadScore: 'hubspot_score',
    product: 'selected_product',
    callOutcome: 'qualification_call_outcome',
    formOrigin: 'recent_form_origin',
    partner: 'partner_name',
    temp: 'lead_temperature',
    requestedAt: 'screening_call_requested_at',
  },
  REQUEST_COOLDOWN: 60,
  REPS: [
    { name: 'Andreas Petratos', email: 'andreas@quatt.io', hubspotUserId: 'FILL', hubspotOwnerId: 'FILL' },
    { name: 'Sales Rep 2',      email: 'rep2@quatt.io',    hubspotUserId: 'FILL', hubspotOwnerId: 'FILL' },
  ],
  ADMINS: ['andreas@quatt.io'],
  DEMO_MODE: true,
  CUSTOM_PLAYBOOKS: [],
  CUSTOM_SCHEDULERS: [],
}

export const isDemo = (): boolean =>
  CONFIG.DEMO_MODE || CONFIG.HUBSPOT_TOKEN.includes('YOUR_TOKEN')

export const isGoogleConfigured = (): boolean =>
  !CONFIG.GOOGLE_CLIENT_ID.includes('YOUR_CLIENT')
