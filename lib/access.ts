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

// Admin-only API writes (playbooks/schedulers PUT, feedback list/PATCH/DELETE,
// AI triage, copy-from-production) are allowed for these emails only.
export const ADMINS: string[] = ['andreas@quatt.io']
