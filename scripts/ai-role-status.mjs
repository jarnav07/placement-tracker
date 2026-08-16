import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna'

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

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false },
})

const today = new Date().toISOString().slice(0, 10)
const timeoutMs = 60000
const maxConcurrent = 3
const aiRecheckDays = 14
const maxWebSearchCalls = 4
const cacheKey = 'discover-aerospace-role-status-v1'

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'UNKNOWN'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    exact_role_found: { type: 'boolean' },
    official_source_found: { type: 'boolean' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { url: { type: 'string' }, description: { type: 'string' } },
        required: ['url', 'description'],
      },
    },
  },
  required: ['status', 'confidence', 'reason', 'exact_role_found', 'official_source_found', 'sources'],
}

// Keep the stable research policy in one cacheable prefix. Role-specific data and
// the current date remain after the cache breakpoint because they change per call.
const stableInstructions = `You are Discover Aerospace's application-status research agent. Determine whether an EXACT aerospace/engineering placement is currently open for applications.

Research policy:
1. Research the exact vacancy, not merely the employer or a generic careers page.
2. Search the web using the exact company and role title; add location/year when useful.
3. Prefer the employer's official careers/application page. Use reputable secondary sources only as supporting evidence.
4. A generic careers page is never sufficient evidence that this exact role is open.
5. If a known vacancy URL is dead, search for the same exact vacancy on the employer site and use a replacement URL if found.
6. OPEN requires strong evidence that applications for this exact vacancy can currently be submitted.
7. CLOSED requires strong evidence that this exact vacancy is closed, filled, withdrawn, expired, or no longer accepting applications.
8. UNKNOWN means the exact role cannot be located or the available evidence is ambiguous.
9. Never infer OPEN merely because a URL returns HTTP 200.
10. Never infer CLOSED merely because an old URL returns 404; the vacancy may have moved.
11. Ignore the database's current status as evidence and make an independent determination.
12. Be conservative. If evidence conflicts or is weak, return UNKNOWN.
13. Cite the strongest sources actually used. Prefer official employer evidence.
14. Stop searching once you have enough high-quality evidence for a confident decision; do not perform unnecessary searches.
15. Return only the required structured result. Keep the reason concise and sources limited to the strongest evidence.`

function normaliseUrl(value) {
  if (!value) return null
  try { return new URL(value).toString() } catch { return null }
}

function getLastAiResearchDate(notes = '') {
  const matches = [...String(notes).matchAll(/AI research (\d{4}-\d{2}-\d{2})/g)]
  return matches.length ? matches[matches.length - 1][1] : null
}

function daysSince(dateString) {
  if (!dateString) return Infinity
  return Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${dateString}T00:00:00Z`)) / 86400000)
}

function isNotInterested(role) {
  return String(role.app_status ?? '').trim().toLowerCase() === 'not interested'
}

function shouldResearch(role) {
  if (isNotInterested(role)) return { research: false, reason: 'Not Interested' }
  const sourceVerified = String(role.source_verified ?? '').toLowerCase()
  const lastAiDate = getLastAiResearchDate(role.notes ?? '')
  if (!lastAiDate) return { research: true, reason: 'new/no previous AI research' }
  if (sourceVerified.includes('url check failed') || sourceVerified.includes('role status: unknown')) {
    return { research: true, reason: 'URL/status check needs AI investigation' }
  }
  const age = daysSince(lastAiDate)
  if (age >= aiRecheckDays) return { research: true, reason: `${age} days since last AI research` }
  return { research: false, reason: `AI research is ${age} days old` }
}

function buildRolePrompt(role) {
  const links = [role.application_link, role.careers_page, role.source_url]
    .map(normaliseUrl).filter(Boolean)
  return `Current date: ${today}

Exact placement to investigate:
Company: ${role.company ?? ''}
Role: ${role.specific_role ?? ''}
Location: ${role.city ?? ''}
Current database status: ${role.application_status ?? ''}
Known URLs:
${links.length ? links.map(url => `- ${url}`).join('\n') : '- none'}

Determine OPEN, CLOSED, or UNKNOWN for this exact vacancy. Return the structured result only.`
}

async function askAgent(role) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        prompt_cache_key: cacheKey,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
        max_tool_calls: maxWebSearchCalls,
        max_output_tokens: 500,
        tools: [{ type: 'web_search' }],
        input: [
          {
            type: 'message',
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: stableInstructions,
                prompt_cache_breakpoint: { mode: 'explicit' },
              },
            ],
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: buildRolePrompt(role) }],
          },
        ],
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'role_status_research',
            strict: true,
            schema,
          },
        },
      }),
    })

    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || `OpenAI API returned HTTP ${response.status}`)
    if (!body?.output_text) throw new Error('OpenAI returned no output_text.')

    const result = JSON.parse(body.output_text)
    if (!['OPEN', 'CLOSED', 'UNKNOWN'].includes(result.status)) throw new Error(`Invalid AI status: ${result.status}`)
    if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new Error('Invalid AI confidence.')

    const cached = body?.usage?.input_tokens_details?.cached_tokens ?? 0
    const totalInput = body?.usage?.input_tokens ?? 0
    console.log(`AI usage — ${role.company} / ${role.specific_role}: ${totalInput} input tokens, ${cached} cached`)
    return result
  } finally {
    clearTimeout(timer)
  }
}

function canChangeAvailabilityStatus(currentStatus) {
  const status = String(currentStatus ?? '').trim().toLowerCase()
  if (!status) return true
  const protectedStatuses = ['applied', 'application submitted', 'interview', 'interviewing', 'rejected', 'offer', 'offered', 'accepted', 'withdrawn', 'not interested']
  return !protectedStatuses.some(value => status === value || status.includes(value))
}

function formatSources(sources = []) {
  return sources.filter(s => s?.url).slice(0, 3)
    .map(s => `${s.url} — ${s.description}`).join('\n')
}

async function processRole(role, researchReason) {
  try {
    const result = await askAgent(role)
    const strong = (result.status === 'OPEN' || result.status === 'CLOSED') && result.confidence >= 0.80
    const canUpdate = canChangeAvailabilityStatus(role.application_status)
    const apply = strong && canUpdate
    const sourceText = formatSources(result.sources)
    const summary = [
      `AI research ${today}: ${result.status} (${Math.round(result.confidence * 100)}% confidence).`,
      `Triggered because: ${researchReason}.`,
      result.reason,
      sourceText ? `Sources:\n${sourceText}` : '',
    ].filter(Boolean).join('\n')

    const updates = {
      source_date_checked: today,
      source_verified: `AI research: ${result.status} (${Math.round(result.confidence * 100)}% confidence); ${result.reason}`,
      updated_at: new Date().toISOString(),
    }

    if (apply) updates.application_status = result.status === 'OPEN' ? 'Open Now' : 'Closed'

    const existingNotes = role.notes?.trim() || ''
    const oldResearchStart = existingNotes.indexOf('AI research ')
    const preservedNotes = oldResearchStart >= 0 ? existingNotes.slice(0, oldResearchStart).trimEnd() : existingNotes
    updates.notes = preservedNotes ? `${preservedNotes}\n\n${summary}` : summary

    const { error } = await supabase.from('placements').update(updates).eq('id', role.id)
    if (error) throw error

    console.log(`${role.company} — ${role.specific_role ?? 'role'}: ${result.status} (${Math.round(result.confidence * 100)}%); ${apply ? 'STATUS UPDATED' : canUpdate ? 'status unchanged' : 'tracking status protected'}`)
    return result.status
  } catch (error) {
    console.error(`${role.company} — ${role.specific_role ?? 'role'}: AI research failed: ${error?.message ?? error}`)
    return 'ERROR'
  }
}

async function main() {
  console.log(`Using OpenAI model: ${model}`)
  console.log(`Established-role AI recheck interval: ${aiRecheckDays} days`)
  console.log(`Maximum web searches per AI investigation: ${maxWebSearchCalls}`)
  console.log('Prompt caching: shared stable research policy, 30-minute TTL')

  const { data: placements, error } = await supabase
    .from('placements')
    .select('id, company, specific_role, city, application_status, app_status, application_link, careers_page, source_url, source_verified, notes')
  if (error) throw error

  const selected = []
  let skipped = 0
  let notInterestedSkipped = 0

  for (const role of placements ?? []) {
    const decision = shouldResearch(role)
    if (decision.research) selected.push({ role, reason: decision.reason })
    else {
      skipped++
      if (decision.reason === 'Not Interested') notInterestedSkipped++
    }
  }

  console.log(`AI selection: ${selected.length} of ${placements?.length ?? 0} roles require research; ${skipped} skipped (${notInterestedSkipped} Not Interested).`)

  let cursor = 0, open = 0, closed = 0, unknown = 0, errors = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= selected.length) return
      const item = selected[index]
      const status = await processRole(item.role, item.reason)
      if (status === 'OPEN') open++
      else if (status === 'CLOSED') closed++
      else if (status === 'UNKNOWN') unknown++
      else errors++
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, selected.length) }, worker))
  console.log(`AI research complete: ${open} open, ${closed} closed, ${unknown} unknown, ${errors} errors, ${skipped} skipped (${notInterestedSkipped} Not Interested).`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
