/**
 * Integration test against the real HubSpot API.
 * Run: HUBSPOT_TOKEN=pat-xxx node scripts/test-hubspot.mjs
 * Tests every HubSpot operation the sales tool performs.
 * Creates and immediately deletes real objects — safe on production tokens.
 */

const TOKEN = process.env.HUBSPOT_TOKEN
const BASE  = 'https://api.hubapi.com'
let passed = 0, failed = 0

function parseHsError(text) {
  try {
    const d = JSON.parse(text)
    let msg = d.message || d.error || text.slice(0, 400)
    if (Array.isArray(d.validationResults) && d.validationResults.length) {
      const fields = d.validationResults
        .map(r => [r.name, r.error, r.message].filter(Boolean).join(':'))
        .join(', ')
      msg += `  ← FIELDS: [${fields}]`
    }
    if (d.context) msg += `  ← CONTEXT: ${JSON.stringify(d.context).slice(0, 200)}`
    return msg
  } catch { return text.slice(0, 400) }
}

async function hs(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  if (body !== undefined && method !== 'GET' && method !== 'DELETE') opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  return { ok: res.ok, status: res.status, text, json: () => JSON.parse(text) }
}

function pass(label) { console.log(`  ✓ ${label}`); passed++ }
function fail(label, detail) { console.error(`  ✗ ${label}: ${detail}`); failed++ }
function check(label, r, detail = '') {
  r.ok ? pass(label) : fail(label, detail || parseHsError(r.text))
}
function section(name) { console.log(`\n── ${name}`) }

async function testAuth() {
  section('Auth')
  if (!TOKEN) { fail('HUBSPOT_TOKEN set', 'env var missing'); process.exit(1) }
  const r = await hs('GET', '/crm/v3/owners?limit=1')
  check('token is valid', r)
  return r.ok ? String(r.json().results?.[0]?.id || '') : ''
}

async function testTaskSchema() {
  section('Task schema')
  const r = await hs('GET', '/crm/v3/properties/tasks')
  check('fetch task properties', r)
  if (!r.ok) return

  const props = r.json().results || []
  console.log(`  ℹ  ${props.length} properties total`)

  const typeP = props.find(p => p.name === 'hs_task_type')
  if (typeP) {
    const vals = (typeP.options || []).map(o => o.value).join(', ')
    console.log(`  ℹ  hs_task_type valid values: ${vals || '(none)'}`)
    pass('hs_task_type exists on tasks object')
  } else {
    fail('hs_task_type exists on tasks object', 'property not found')
  }

  const required = props.filter(p => p.formField).map(p => p.name)
  console.log(`  ℹ  Form-required: [${required.join(', ') || 'none'}]`)
  // Print all date/datetime properties — helps find the correct due-date field name
  const dateProps = props.filter(p => p.type === 'date' || p.type === 'datetime' || p.name.includes('due') || p.name.includes('date'))
  console.log(`  ℹ  Date/due properties: [${dateProps.map(p => p.name + ':' + p.type).join(', ')}]`)
}

async function tryCreate(label, properties) {
  const r = await hs('POST', '/crm/v3/objects/tasks', { properties })
  if (r.ok) {
    pass(label)
    await hs('DELETE', `/crm/v3/objects/tasks/${r.json().id}`)
  } else {
    fail(label, parseHsError(r.text))
  }
}

async function testTaskVariants(ownerId) {
  section('Task creation variants')
  const now = String(Date.now())
  const due = String(Date.now() + 86400000)

  // hs_timestamp is required by HubSpot on all task creates (confirmed from CI output)
  await tryCreate('minimal (subject + status + timestamp)', {
    hs_task_subject: '[CI] minimal',
    hs_task_status: 'NOT_STARTED',
    hs_timestamp: now,
  })
  await tryCreate('+ hubspot_owner_id', {
    hs_task_subject: '[CI] with owner',
    hs_task_status: 'NOT_STARTED',
    hs_timestamp: now,
    hubspot_owner_id: ownerId,
  })
  await tryCreate('+ hs_task_type TODO', {
    hs_task_subject: '[CI] with type',
    hs_task_status: 'NOT_STARTED',
    hs_task_type: 'TODO',
    hs_timestamp: now,
    hubspot_owner_id: ownerId,
  })
  // hs_task_due_date does not exist in this portal — skip until correct property found above
  await tryCreate('full tool payload (no due date)', {
    hs_task_subject: '[CI] full payload',
    hs_task_body: '[lead:999]\nCI note',
    hs_task_status: 'NOT_STARTED',
    hs_task_type: 'TODO',
    hs_timestamp: now,
    hubspot_owner_id: ownerId,
  })
}

async function testLeadsAccess() {
  section('Leads access')
  const r = await hs('GET', '/crm/v3/properties/leads?limit=1')
  check('read leads properties', r)
}

async function testAssociationLabels() {
  section('Task → Lead association labels')
  const r = await hs('GET', '/crm/v4/associations/tasks/leads/labels')
  check('fetch association types', r)
  if (r.ok) {
    const types = r.json().results || []
    console.log(`  ℹ  ${types.length} type(s):`, JSON.stringify(types))
  }
}

async function main() {
  console.log('=== HubSpot integration tests ===')
  const ownerId = await testAuth()
  if (ownerId) console.log(`\n  ℹ  owner ID: ${ownerId}`)
  else         console.warn('\n  ⚠  no owner ID resolved — some tests may fail')

  await testTaskSchema()
  await testTaskVariants(ownerId)
  await testLeadsAccess()
  await testAssociationLabels()

  console.log(`\n${'─'.repeat(40)}\nPassed: ${passed}  Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1) })
