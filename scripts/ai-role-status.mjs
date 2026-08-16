import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini'

if (!rawSupabaseUrl || !supabaseKey) throw new Error('Missing Supabase secrets')
if (!openAiKey) throw new Error('Missing OPENAI_API_KEY GitHub Actions secret.')

let supabaseUrl
try {
  const parsed = new URL(rawSupabaseUrl)
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  supabaseUrl = parsed.toString().replace(/\/$/, '')
} catch {
  throw new Error(`Invalid SUPABASE_URL: ${rawSupabaseUrl}`)
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { enabled: false } })
const today = new Date().toISOString().slice(0, 10)
const timeoutMs = 60000
const maxConcurrent = 3
const weeklyRecheckDays = 7

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'UNKNOWN'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    exact_role_found: { type: 'boolean' },
    official_source_found: { type: 'boolean' },
    sources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string' }, description: { type: 'string' } }, required: ['url', 'description'] } },
  },
  required: ['status', 'confidence', 'reason', 'exact_role_found', 'official_source_found', 'sources'],
}

function normaliseUrl(value) { if (!value) return null; try { return new URL(value).toString() } catch { return null } }

function extractLastAiResearchDate(notes = '') {
  const matches = [...String(notes).matchAll(/AI research (\d{4}-\d{2}-\d{2}):/g)]
  return matches.length ? matches[matches.length - 1][1] : null
}

function daysSince(dateString) {
  if (!dateString) return Infinity
  const then = new Date(`${dateString}T00:00:00Z`)
  const now = new Date(`${today}T00:00:00Z`)
  return Math.floor((now - then) / 86400000)
}

function needsAiResearch(role) {
  const lastResearch = extractLastAiResearchDate(role.notes)
  const sourceVerification = String(role.source_verified ?? '').toLowerCase()
  const applicationStatus = String(role.application_status ?? '').toLowerCase()

  // New roles: they have never had an AI research result.
  if (!lastResearch) return { yes: true, reason: 'new/unresearched role' }

  // Broken/ambiguous URLs should be investigated immediately rather than waiting a week.
  if (/failed|unreachable|broken|404|not found|unable to reach|could not reach|error/.test(sourceVerification)) {
    return { yes: true, reason: 'URL/status check indicates a problem' }
  }

  // Explicitly unknown/ambiguous statuses deserve another research pass.
  if (/unknown|pending|needs review|ambiguous/.test(applicationStatus)) {
    return { yes: true, reason: 'ambiguous application status' }
  }

  // Otherwise, re-research each tracked role once per week rather than twice per day.
  if (daysSince(lastResearch) >= weeklyRecheckDays) {
    return { yes: true, reason: `weekly recheck (${daysSince(lastResearch)} days since last AI research)` }
  }

  return { yes: false, reason: `AI research is current (${lastResearch})` }
}

function buildPrompt(role) {
  const links = [role.application_link, role.careers_page, role.source_url].map(normaliseUrl).filter(Boolean)
  return `You are the application-status research agent for an aerospace engineering placement tracker.

Determine whether THIS EXACT PLACEMENT is currently open for applications as of ${today}.

Company: ${role.company ?? ''}
Role title: ${role.specific_role ?? ''}
Current database status: ${role.application_status ?? ''}
Known links:\n${links.length ? links.map(url => `- ${url}`).join('\n') : '- none'}

RESEARCH RULES
1. Research the exact role, not merely the company's careers page.
2. Search the web for the exact company + role title and relevant placement year/location when useful.
3. Prefer the employer's official careers/application page as evidence; use reputable secondary sources only as support.
4. A generic careers page is NOT evidence that this exact role is open.
5. If an old URL is dead, search for the same exact vacancy on the employer site and cite a replacement if found.
6. OPEN requires strong evidence applications for this exact vacancy can currently be submitted.
7. CLOSED requires strong evidence the exact vacancy is closed, filled, withdrawn, expired, or no longer accepting applications.
8. UNKNOWN means evidence is ambiguous, the exact role cannot be located, or only generic/company-level evidence exists.
9. Never infer OPEN just because HTTP 200 is returned.
10. Never infer CLOSED just because an old URL returns 404 if the role may have moved.
11. Do not use the current database status as evidence; independently research it.
12. Be conservative. Only return OPEN or CLOSED with high-quality evidence.

Return only the structured result and include the strongest URLs actually used as sources.`
}

async function askAgent(role) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
      body: JSON.stringify({ model, tools: [{ type: 'web_search' }], input: buildPrompt(role), text: { format: { type: 'json_schema', name: 'role_status_research', strict: true, schema } } }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || `OpenAI API returned HTTP ${response.status}`)
    if (!body?.output_text) throw new Error('OpenAI returned no output_text.')
    const result = JSON.parse(body.output_text)
    if (!['OPEN', 'CLOSED', 'UNKNOWN'].includes(result.status)) throw new Error(`Invalid AI status: ${result.status}`)
    if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new Error('Invalid AI confidence.')
    return result
  } finally { clearTimeout(timer) }
}

function canChangeAvailabilityStatus(currentStatus) {
  const status = String(currentStatus ?? '').trim().toLowerCase()
  if (!status) return true
  const protectedStatuses = ['applied', 'application submitted', 'interview', 'interviewing', 'rejected', 'offer', 'offered', 'accepted', 'withdrawn', 'not interested']
  return !protectedStatuses.some(value => status === value || status.includes(value))
}

function formatSources(sources = []) { return sources.filter(s => s?.url).slice(0, 5).map(s => `${s.url} — ${s.description}`).join('\n') }

async function processRole(role, researchReason) {
  try {
    const result = await askAgent(role)
    const strong = (result.status === 'OPEN' || result.status === 'CLOSED') && result.confidence >= 0.80
    const canUpdate = canChangeAvailabilityStatus(role.application_status)
    const apply = strong && canUpdate
    const sourceText = formatSources(result.sources)
    const summary = [`AI research ${today}: ${result.status} (${Math.round(result.confidence * 100)}% confidence).`, `Reason triggered: ${researchReason}.`, result.reason, sourceText ? `Sources:\n${sourceText}` : ''].filter(Boolean).join('\n')
    const updates = { source_date_checked: today, source_verified: `AI research: ${result.status} (${Math.round(result.confidence * 100)}% confidence); ${result.reason}`, updated_at: new Date().toISOString() }
    if (apply) updates.application_status = result.status === 'OPEN' ? 'Open Now' : 'Closed'
    const existingNotes = role.notes?.trim() || ''
    const marker = 'AI research '
    const oldResearchStart = existingNotes.indexOf(marker)
    const preservedNotes = oldResearchStart >= 0 ? existingNotes.slice(0, oldResearchStart).trimEnd() : existingNotes
    updates.notes = preservedNotes ? `${preservedNotes}\n\n${summary}` : summary
    const { error } = await supabase.from('placements').update(updates).eq('id', role.id)
    if (error) throw error
    console.log(`${role.company} — ${role.specific_role ?? 'role'}: ${result.status} (${Math.round(result.confidence * 100)}%); ${apply ? 'STATUS UPDATED' : canUpdate ? 'status unchanged' : 'tracking status protected'}`)
    return result.status
  } catch (error) { console.error(`${role.company} — ${role.specific_role ?? 'role'}: AI research failed: ${error?.message ?? error}`); return 'ERROR' }
}

async function main() {
  console.log(`Using OpenAI model: ${model}`)
  const { data: placements, error } = await supabase.from('placements').select('id, company, specific_role, application_status, application_link, careers_page, source_url, source_verified, notes')
  if (error) throw error

  const selected = []
  let skipped = 0
  for (const role of placements ?? []) {
    const decision = needsAiResearch(role)
    if (decision.yes) selected.push({ role, reason: decision.reason })
    else skipped++
  }

  console.log(`AI research selection: ${selected.length} selected, ${skipped} skipped.`)
  if (!selected.length) {
    console.log('No AI research required this run.')
    return
  }

  let cursor = 0, open = 0, closed = 0, unknown = 0, errors = 0
  async function worker() {
    while (true) {
      const index = cursor++; if (index >= selected.length) return
      const { role, reason } = selected[index]
      const status = await processRole(role, reason)
      if (status === 'OPEN') open++; else if (status === 'CLOSED') closed++; else if (status === 'UNKNOWN') unknown++; else errors++
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, selected.length) }, worker))
  console.log(`AI research complete: ${open} open, ${closed} closed, ${unknown} unknown, ${errors} errors.`)
}

main().catch(error => { console.error(error); process.exit(1) })
