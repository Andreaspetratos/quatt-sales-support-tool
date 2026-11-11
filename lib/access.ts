// Who may use the tool, and who is an admin.
//
// Imported by both the frontend (lib/config.ts, LoginPage) and the server-side
// auth middleware (functions/api/_middleware.js), so it must stay dependency-free:
// no imports, no process.env, no window. The middleware is what actually
// enforces these rules; the frontend only uses them to decide what to show.

// Google OAuth client ID of the login button. The middleware rejects any
// Google ID token whose `aud` is not this value.
export const GOOGLE_CLIENT_ID = '389875784063-rg6aporjtdsb0trolriuqrp97d94rgi7.apps.googleusercontent.com'

// Only Google Workspace accounts of this domain can sign in.
export const ALLOWED_DOMAIN = 'quatt.io'

// Admins: members of these HubSpot teams (primary or secondary team), plus the
// ADMINS emails below. Admins get the admin panel, and only admins may make the
// admin-only API calls (playbooks/schedulers PUT, feedback list/PATCH/DELETE,
// AI triage, copy-from-production).
export const ADMIN_TEAM_IDS: string[] = [
  '187118858', // production portal: "Sales Support Tool Managers"
  '187124885', // sandbox portal: the same team
]

// Always admin, even if the HubSpot team lookup fails. Keep this short.
export const ADMINS: string[] = ['andreas@quatt.io']

// Who may use the tool at all. A @quatt.io Google account is not enough: the
// person must also be a member (primary or secondary team) of the Sales Support
// team or of an admin team above, or be in ADMINS. Everyone else gets the
// "no access" screen after signing in, and the middleware refuses all their
// /api calls, so they can't read leads (Andreas, 2026-11-11: a @quatt.io
// colleague outside Sales Support could open the tool and see leads).
export const SALES_SUPPORT_TEAM_IDS: string[] = [
  '140339728', // production portal: "Sales Support Team (Dennis)"
  '181494519', // sandbox portal: the same team
]
export const ACCESS_TEAM_IDS: string[] = [...SALES_SUPPORT_TEAM_IDS, ...ADMIN_TEAM_IDS]

// `code` in the middleware's 403 answer for someone outside those teams. The
// frontend shows the "no access" screen when it sees it.
export const NO_ACCESS_CODE = 'no_team_access'
