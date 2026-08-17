// High-precision verification: exact student programme + current intake + exact live role + direct application evidence.
import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna'

if (!rawSupabaseUrl || !supabaseKey) throw new Error('Missing Supabase secrets')
if (!openAiKey) throw new Error('Missing OPENAI_API_KEY GitHub Actions secret.')

const supabaseUrl = new URL(rawSupabaseUrl)
supabaseUrl.pathname = ''
supabaseUrl.search = ''
supabaseUrl.hash = ''

const supabase = createClient(supabaseUrl.toString().replace(/\/$/, ''), supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false }
})

const TODAY = new Date().toISOString().slice(0, 10)
const MAX_CONCURRENT = 2
const MAX_WEB_SEARCHES = 8
const AI_RECHECK_DAYS = 7
const MIN_CONFIDENCE = 0.88

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'UNKNOWN'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    exact_student_program_found: { type: 'boolean' },
    exact_role_found: { type: 'boolean' },
    current_intake_matches: { type: 'boolean' },
    direct_application_for_exact_role_found: { type: 'boolean' },
    official_program_source_found: { type: 'boolean' },
    evidence_summary: { type: 'string' },
    application_window: { type: 'string' },
    intake_year: { type: 'string' },
    opening_timing: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          type: { type: 'string' },
          evidence: { type: 'string' }
        },
        required: ['url', 'type', 'evidence']
      }
    }
  },
  required: [
    'status',
    'confidence',
    'exact_student_program_found',
    'exact_role_found',
    'current_intake_matches',
    'direct_application_for_exact_role_found',
    'official_program_source_found',
    'evidence_summary',
    'application_window',
    'intake_year',
    'opening_timing',
    'sources'
  ]
}

// Keep the verifier instructions in ordinary quoted strings. This deliberately avoids
// template-literal backticks inside the prompt, which caused the previous CI syntax error.
const instructions = [
  'You are the high-precision verification agent for an engineering student placement tracker.',
  '',
  'Your job is NOT to decide whether a company has an Apply button. Decide whether the EXACT STUDENT INTERNSHIP / INDUSTRIAL PLACEMENT / YEAR-IN-INDUSTRY / WORK PLACEMENT / CO-OP OR EQUIVALENT STUDENT PROGRAM AND THE EXACT ROLE are currently open for applications on the current date.',
  '',
  'A false positive is worse than UNKNOWN, but avoid false negatives by investigating both the employer student-program pages and the employer job board thoroughly.',
  '',
  'OPEN requires ALL: (1) relevant student placement programme identified; (2) relevant current intake identified; (3) exact tracked role currently present on the employer live vacancy/job-board results OR employer explicitly says this exact role/program is currently accepting applications; (4) direct application evidence for THAT EXACT ROLE; (5) no stronger closed/expired/previous-intake evidence; (6) high confidence. If any is uncertain, UNKNOWN.',
  '',
  'CLOSED applies when reliable evidence says the exact role/intake is closed, filled, expired, withdrawn, deadline passed, or clearly belongs to a previous intake no longer accepting applications. UNKNOWN applies when exact current availability cannot be proven or evidence conflicts.',
  '',
  'CRITICAL RULES: Generic Apply/View Jobs/Search Jobs buttons are NOT availability evidence. If a button opens a job board, inspect that board and find the EXACT tracked role; if absent from the first page, DO NOT conclude CLOSED or OPEN. The board may be paginated, filtered, searchable, dynamically loaded, or use a different keyword. Use pagination/next-page controls where accessible and the board own search/filter controls when available. Search the exact role title first, then sensible variants including the employer + intern, internship, placement, industrial placement, year in industry, student, undergraduate, or equivalent local terminology. Also search the employer site directly with those terms. Do not require the exact database title to be a literal string match if the employer uses an obvious equivalent title, but verify role duties, discipline, location, and intake are the same.',
  '',
  'MULTI-PAGE JOB BOARDS: A first-page absence is NEVER evidence of closure. If pagination exists, inspect additional relevant pages until the exact role is found, a reliable closed signal is found, or reasonable relevant pages/search results have been exhausted. Prefer the board search/filter function over blindly opening many pages. If a board exposes page numbers, next/previous links, offset/page query parameters, or filtered result URLs, follow the relevant continuation pages. If it has dozens of pages, do NOT blindly crawl them: use exact-role and programme-keyword searches, filters, and targeted page navigation first.',
  '',
  'KEYWORD SEARCH: Some job boards only reveal student roles after searching. Try targeted searches for the exact role plus programme terms. For example, if the role is an aerospace engineering placement, search combinations such as Aerospace, Engineering, Intern, Placement, Industrial Placement, and Year in Industry. If the board has a search box, use it rather than relying only on the default listing. Try both the role title and broader student-programme terms when the exact title produces no result. Do not mark OPEN merely because a generic internship exists; it must correspond to the tracked role.',
  '',
  'JOB-BOARD SEARCH FALLBACK: If the known URL is a generic board, first inspect its visible controls and current result set. Then search the board for the exact tracked role. If that fails, search the employer domain for the exact role and targeted student terms. If the employer uses an external ATS, search for the same exact vacancy on that ATS and verify that it is the employer current student vacancy. If a search result points to a stale or previous-intake page, keep searching for a current equivalent before deciding.',
  '',
  'PROGRAMME VS JOB-BOARD DISTINCTION: First establish that the employer actually recruits students for the relevant placement/year. Then establish that the exact role is part of that programme and belongs to the current intake. A generic graduate role, summer internship, apprenticeship, experienced-hire vacancy, or unrelated student job does not qualify.',
  '',
  'TIMING AND STALE LISTINGS: Treat seasonal wording such as applications typically opening in October-November as evidence it is NOT open before that window unless stronger current evidence proves otherwise. Treat applications closed, intake closed, no longer accepting, deadline passed, position filled, and equivalent language as strong negative evidence. A listing with a 2026 start date can be a previous intake when the current date is later in 2026; do not assume it is current merely because the page still exists. Distinguish current 2027/2028 cycles from stale 2026 cycles. Dates in search snippets can also be stale; verify on the current employer source when possible.',
  '',
  'SOURCE PRIORITY: Prefer the employer official student-programme page, official job board, and official exact-vacancy page. Use reputable secondary sources only to discover leads or corroborate evidence. Never infer from HTTP 200, page existence, search indexing, a generic careers page, or a generic Apply button. Never infer CLOSED merely because an old URL returns 404; search for a moved/reposted current vacancy first.',
  '',
  'SEARCH BUDGET: You have up to 8 web searches/tool calls. Use them intelligently: start with the exact role and official employer domain, then the employer student programme, then targeted job-board searches/keywords, and use remaining searches to resolve conflicts, intake dates, pagination, or seasonal opening information. Stop early only when the evidence is genuinely decisive.',
  '',
  'If evidence conflicts, resolve it with a more authoritative/current source or return UNKNOWN. Do not invent dates or availability. Return only the structured result.'
].join('\n')

function links(role) {
  return [role.application_link, role.careers_page, role.source_url]
    .filter(Boolean)
    .map(value => {
      try { return new URL(value).toString() } catch { return null }
    })
    .filter(Boolean)
}

function buildPrompt(role) {
  const knownUrls = links(role)
  return [
    `Current date: ${TODAY}`,
    '',
    `Company: ${role.company ?? ''}`,
    `Role: ${role.specific_role ?? ''}`,
    `Location: ${role.city ?? ''}`,
    `Engineering area: ${role.engineering_area ?? role.department ?? ''}`,
    'Known URLs:',
    knownUrls.length ? knownUrls.map(url => `- ${url}`).join('\n') : '- none',
    '',
    'SEARCH PLAN: Investigate the exact role first. If the known URL leads to a general job board, inspect the board search/filter/pagination controls, search the exact role, then try relevant student keywords such as intern, internship, placement, industrial placement, year in industry, student, or undergraduate. If results are paginated, use relevant next-page/page-number controls or targeted filters/searches rather than checking only page 1. If the board has many pages, do not blindly crawl every page; use its search/filter features and targeted continuation pages. Separately verify the employer student placement programme and current intake. Check for seasonal opening dates, stale start years, and explicit closed/filled/deadline language. If the exact role is not found, do not call it CLOSED merely because page 1 or the default board view lacks it.',
    '',
    'Determine whether this exact student placement is OPEN, CLOSED, or UNKNOWN today. Do not treat a generic job-board button as evidence.'
  ].join('\n')
}

async function ask(role) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'medium' },
        max_tool_calls: MAX_WEB_SEARCHES,
        max_output_tokens: 1200,
        tools: [{ type: 'web_search' }],
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: instructions }] },
          { role: 'user', content: [{ type: 'input_text', text: buildPrompt(role) }] }
        ],
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'reliable_student_placement_status',
            strict: true,
            schema
          }
        }
      })
    })

    const body = await response.json()
    if (!response.ok) {
      throw new Error(body?.error?.message || `OpenAI API returned HTTP ${response.status}`)
    }
    if (!body?.output_text) throw new Error('OpenAI returned no output_text.')

    const result = JSON.parse(body.output_text)
    if (!['OPEN', 'CLOSED', 'UNKNOWN'].includes(result.status) || !Number.isFinite(result.confidence)) {
      throw new Error('Invalid verification result.')
    }

    const safeOpen = result.status === 'OPEN' &&
      result.confidence >= MIN_CONFIDENCE &&
      result.exact_student_program_found &&
      result.exact_role_found &&
      result.current_intake_matches &&
      result.direct_application_for_exact_role_found &&
      result.official_program_source_found

    if (result.status === 'OPEN' && !safeOpen) {
      result.status = 'UNKNOWN'
      result.evidence_summary = `Safety downgrade: exact current student-placement evidence was incomplete. ${result.evidence_summary}`
    }

    return result
  } finally {
    clearTimeout(timeout)
  }
}

function protectedStatus(value) {
  const status = String(value ?? '').trim().toLowerCase()
  return ['applied', 'application submitted', 'interview', 'interviewing', 'rejected', 'offer', 'offered', 'accepted', 'withdrawn', 'not interested']
    .some(item => status === item || status.includes(item))
}

function sourceText(sources = []) {
  return sources
    .filter(source => source?.url)
    .slice(0, 5)
    .map(source => `${source.type}: ${source.url} — ${source.evidence}`)
    .join('\n')
}

async function processRole(role) {
  if (String(role.app_status ?? '').trim().toLowerCase() === 'not interested') return 'SKIPPED'

  try {
    const result = await ask(role)
    const evidence = sourceText(result.sources)
    const notes = [
      `Placement verification ${TODAY}: ${result.status} (${Math.round(result.confidence * 100)}% confidence).`,
      `Student programme: ${result.exact_student_program_found ? 'verified' : 'not verified'}; exact role: ${result.exact_role_found ? 'verified' : 'not verified'}; current intake: ${result.current_intake_matches ? 'matched' : 'not matched'}.`,
      `Direct exact-role application: ${result.direct_application_for_exact_role_found ? 'verified' : 'not verified'}; official programme source: ${result.official_program_source_found ? 'verified' : 'not verified'}.`,
      `Intake: ${result.intake_year || 'not established'}; application window: ${result.application_window || 'not established'}; opening timing: ${result.opening_timing || 'not established'}.`,
      result.evidence_summary,
      evidence ? `Evidence sources:\n${evidence}` : ''
    ].filter(Boolean).join('\n')

    const update = {
      source_date_checked: TODAY,
      source_verified: `Reliable placement verification: ${result.status} (${Math.round(result.confidence * 100)}% confidence); ${result.evidence_summary}`,
      updated_at: new Date().toISOString(),
      notes
    }

    if (!protectedStatus(role.app_status) && !protectedStatus(role.application_status)) {
      update.application_status = result.status === 'OPEN'
        ? 'Open Now'
        : result.status === 'CLOSED'
          ? 'Closed'
          : 'Unknown'
    }

    const { error } = await supabase.from('placements').update(update).eq('id', role.id)
    if (error) throw error

    console.log(`${role.company} — ${role.specific_role}: ${result.status} (${Math.round(result.confidence * 100)}%)`)
    return result.status
  } catch (error) {
    console.error(`${role.company} — ${role.specific_role}: verification failed: ${error?.message ?? error}`)
    return 'ERROR'
  }
}

function shouldResearch(role) {
  const matches = [...String(role.notes ?? '').matchAll(/Placement verification (\d{4}-\d{2}-\d{2})/g)]
  const latest = matches.pop()
  if (!latest) return true

  const age = Math.floor(
    (new Date(`${TODAY}T00:00:00Z`) - new Date(`${latest[1]}T00:00:00Z`)) / 86400000
  )

  return age >= AI_RECHECK_DAYS || (
    String(role.application_status ?? '').trim().toLowerCase() === 'unknown' && age >= 1
  )
}

async function main() {
  const { data: roles, error } = await supabase
    .from('placements')
    .select('id,company,specific_role,city,department,engineering_area,application_status,app_status,application_link,careers_page,source_url,notes')

  if (error) throw error

  const selected = (roles ?? []).filter(role =>
    String(role.app_status ?? '').trim().toLowerCase() !== 'not interested' && shouldResearch(role)
  )

  console.log(`Reliable verification: ${selected.length}/${roles?.length ?? 0} roles selected.`)

  let cursor = 0
  let open = 0
  let closed = 0
  let unknown = 0
  let errors = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= selected.length) return

      const status = await processRole(selected[index])
      if (status === 'OPEN') open++
      else if (status === 'CLOSED') closed++
      else if (status === 'UNKNOWN') unknown++
      else if (status === 'ERROR') errors++
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, selected.length) }, worker))
  console.log(`Reliable verification complete: ${open} OPEN, ${closed} CLOSED, ${unknown} UNKNOWN, ${errors} errors.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
