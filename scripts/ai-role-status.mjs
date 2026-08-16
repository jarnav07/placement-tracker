import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6'

if (!rawSupabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!openAiKey) {
  console.error('Missing OPENAI_API_KEY GitHub Actions secret.')
  process.exit(1)
}

let supabaseUrl
try {
  const parsed = new URL(rawSupabaseUrl)
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  supabaseUrl = parsed.toString().replace(/\/$/, '')
} catch {
  console.error(`Invalid SUPABASE_URL: ${rawSupabaseUrl}`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false },
})

const today = new Date().toISOString().slice(0, 10)
const timeoutMs = 60000
const maxConcurrent = 3

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
        properties: {
          url: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['url', 'description'],
      },
    },
  },
  required: ['status', 'confidence', 'reason', 'exact_role_found', 'official_source_found', 'sources'],
}

function normaliseUrl(value) {
  if (!value) return null
  try { return new URL(value).toString() } catch { return null }
}

function buildPrompt(role) {
  const links = [role.application_link, role.careers_page, role.source_url]
    .map(normaliseUrl)
    .filter(Boolean)

  return `You are the application-status research agent for an aerospace engineering placement tracker.

Your task is to determine whether THIS EXACT PLACEMENT is currently open for applications as of ${today}.

PLACEMENT
Company: ${role.company ?? ''}
Role title: ${role.specific_role ?? ''}
Current database status: ${role.application_status ?? ''}
Known links:
${links.length ? links.map(url => `- ${url}`).join('\n') : '- none'}

RESEARCH RULES
1. Research the exact role, not merely the company's careers page.
2. Search the web for the exact company + role title and relevant placement year/location when useful.
3. Prefer the employer's official careers/application page as evidence. Use reputable secondary sources only as supporting evidence.
4. A generic careers page is NOT evidence that this exact role is open.
5. If an old URL is dead, search for the same exact vacancy on the employer site. If you find a replacement official URL, cite it.
6. OPEN means there is strong evidence that applications for this exact vacancy can currently be submitted.
7. CLOSED means strong evidence says the exact vacancy is closed, filled, withdrawn, expired, or no longer accepting applications.
8. UNKNOWN means the evidence is ambiguous, the exact role cannot be located, or only generic/company-level evidence is available.
9. Never infer OPEN just because a page returns HTTP 200.
10. Never infer CLOSED just because an old URL returns 404 if the role may have moved.
11. Do not use the current database status as evidence; independently research it.
12. Be conservative. A false OPEN could cause a missed deadline, so only return OPEN or CLOSED with high-quality evidence.

Return only the requested structured result. Include the strongest URLs you actually used as sources.`
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
        tools: [{ type: 'web_search' }],
        input: buildPrompt(role),
        text: {
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
    if (!response.ok) {
      throw new Error(body?.error?.message || `OpenAI API returned HTTP ${response.status}`)
    }

    const outputText = body?.output_text
    if (!outputText) throw new Error('OpenAI returned no output_text.')

    const result = JSON.parse(outputText)
    if (!['OPEN', 'CLOSED', 'UNKNOWN'].includes(result.status)) {
      throw new Error(`Invalid AI status: ${result.status}`)
    }
    if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
      throw new Error('Invalid AI confidence.')
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

function shouldApplyStatus(result) {
  return (result.status === 'OPEN' || result.status === 'CLOSED') && result.confidence >= 0.80
}

function formatSources(sources = []) {
  return sources
    .filter(source => source?.url)
    .slice(0, 5)
    .map(source => `${source.url} — ${source.description}`)
    .join('\n')
}

async function processRole(role) {
  try {
    const result = await askAgent(role)
    const apply = shouldApplyStatus(result)
    const sourceText = formatSources(result.sources)
    const researchSummary = [
      `AI research ${today}: ${result.status} (${Math.round(result.confidence * 100)}% confidence).`,
      result.reason,
      sourceText ? `Sources:\n${sourceText}` : '',
    ].filter(Boolean).join('\n')

    const updates = {
      source_date_checked: today,
      source_verified: `AI research: ${result.status} (${Math.round(result.confidence * 100)}% confidence); ${result.reason}`,
      updated_at: new Date().toISOString(),
    }

    // Only let high-confidence AI research change the application status.
    // UNKNOWN or low-confidence results never overwrite the existing status.
    if (apply) updates.application_status = result.status === 'OPEN' ? 'Open Now' : 'Closed'

    // Keep the research in notes without destroying the user's existing notes.
    const existingNotes = role.notes?.trim() || ''
    const marker = 'AI research '
    const oldResearchStart = existingNotes.indexOf(marker)
    const preservedNotes = oldResearchStart >= 0 ? existingNotes.slice(0, oldResearchStart).trimEnd() : existingNotes
    updates.notes = preservedNotes ? `${preservedNotes}\n\n${researchSummary}` : researchSummary

    const { error } = await supabase.from('placements').update(updates).eq('id', role.id)
    if (error) throw error

    console.log(`${role.company} — ${role.specific_role ?? 'role'}: ${result.status} (${Math.round(result.confidence * 100)}%); ${apply ? 'STATUS UPDATED' : 'status unchanged'}`)
    return { status: result.status, applied: apply, confidence: result.confidence }
  } catch (error) {
    console.error(`${role.company} — ${role.specific_role ?? 'role'}: AI research failed: ${error?.message ?? error}`)
    return { status: 'ERROR', applied: false, confidence: 0 }
  }
}

async function main() {
  console.log(`Using OpenAI model: ${model}`)
  const { data: placements, error } = await supabase
    .from('placements')
    .select('id, company, specific_role, application_status, application_link, careers_page, source_url, source_verified, notes')

  if (error) throw error

  console.log(`AI researching ${placements?.length ?? 0} tracked opportunities...`)

  let cursor = 0
  let open = 0
  let closed = 0
  let unknown = 0
  let errors = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= (placements?.length ?? 0)) return
      const result = await processRole(placements[index])
      if (result.status === 'OPEN') open++
      else if (result.status === 'CLOSED') closed++
      else if (result.status === 'UNKNOWN') unknown++
      else errors++
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, placements?.length ?? 0) }, worker))
  console.log(`AI research complete: ${open} open, ${closed} closed, ${unknown} unknown, ${errors} errors.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
