import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

// Which build this is. Baked into the page and published as /version.json, so
// an open tab can tell a newer deployment is live (components/UpdateBanner.tsx).
// Cloudflare Pages provides the commit; locally fall back to git, then the time.
function buildId() {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch {}
  return String(Date.now())
}
const BUILD_ID = buildId()
mkdirSync('public', { recursive: true })
writeFileSync('public/version.json', JSON.stringify({ version: BUILD_ID }) + '\n')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
}

export default nextConfig
