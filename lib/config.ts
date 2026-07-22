import type { Rep, Playbook, Scheduler } from './types'

interface StageIds {
  UQL: string
  MQL: string
  SQL: string
  LOST: string
  DUPLICATE_CHECK: string
}

interface PropNames {
  leadScore: string
  product: string
  callOutcome: string
  formOrigin: string
  partner: string
  requestedAt: string
  lostReasons: string
}

interface AppConfig {
  GOOGLE_CLIENT_ID: string
  MAKE_WEBHOOK_URL: string
  HUBSPOT_TOKEN: string
  CORS_PROXY: string
  SCHEDULER_URL: string
  PIPELINE_ID: string
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
  GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '389875784063-rg6aporjtdsb0trolriuqrp97d94rgi7.apps.googleusercontent.com',
  MAKE_WEBHOOK_URL: process.env.NEXT_PUBLIC_MAKE_WEBHOOK_URL ?? '',
  // Set NEXT_PUBLIC_HUBSPOT_TOKEN in Cloudflare Pages environment variables
  HUBSPOT_TOKEN: process.env.NEXT_PUBLIC_HUBSPOT_TOKEN ?? '',
  CORS_PROXY: '',
  SCHEDULER_URL: '',

  // Consumer Orders lead pipeline
  PIPELINE_ID: '3837045967',
  STAGES: {
    UQL:             '5404393700',
    MQL:             '5404393694',
    SQL:             '5404393697',
    LOST:            '5404393698',
    DUPLICATE_CHECK: '5404393699',
  },

  // Lead object property names
  PROPS: {
    leadScore:   'lead_router_qualification_score_lead',
    product:     'most_recent_selected_product_lead',
    callOutcome: 'qualificationcalloutcome_lead',
    formOrigin:  'most_recent_form_origin_lead',
    partner:     'partner_name_lead',
    requestedAt: 'screening_call_requested_at',
    lostReasons: 'lost_reasons_lead',
  },

  REQUEST_COOLDOWN: 60,

  REPS: [
    {
      name: 'Andreas Petratos',
      email: 'andreas@quatt.io',
      hubspotUserId: '1204243064004',
      hubspotOwnerId: '', // resolved dynamically at login via /crm/v3/owners
    },
    {
      name: 'Jan Hamburger',
      email: 'jan.hamburger@quatt.io',
      hubspotUserId: '1204242382059',
      hubspotOwnerId: '', // fill in once Jan has leads assigned in sandbox
    },
  ],

  ADMINS: ['andreas@quatt.io'],
  DEMO_MODE: false,
  CUSTOM_PLAYBOOKS: [],
  CUSTOM_SCHEDULERS: [],
}

export const isDemo = (): boolean => CONFIG.DEMO_MODE

export const isGoogleConfigured = (): boolean =>
  !CONFIG.GOOGLE_CLIENT_ID.includes('YOUR_CLIENT')

export const stageLabel = (stageId: string): string => {
  const map: Record<string, string> = {
    [CONFIG.STAGES.UQL]:            'UQL',
    [CONFIG.STAGES.MQL]:            'MQL',
    [CONFIG.STAGES.SQL]:            'SQL',
    [CONFIG.STAGES.LOST]:           'Lost',
    [CONFIG.STAGES.DUPLICATE_CHECK]:'Dup. Check',
  }
  return map[stageId] ?? stageId
}
