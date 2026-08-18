// Shared verifier for the placement maintenance pipeline.
//
// Two modes:
//   1. DETERMINISTIC (default, zero API credits): fetches the tracked URLs and
//      applies conservative 2027 + student + open/closed signal rules. It only
//      changes a card when the evidence is explicit; otherwise it leaves the
//      existing status untouched (no guessing).
//   2. AI (opt-in): set USE_OPENAI=true and provide OPENAI_API_KEY to run the
//      high-precision OpenAI web-research verifier instead.
//
// The tracked intake is 2027 (placements that START in 2027).

const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '') || ''
const model = process.env.OPENAI_MODEL?.trim().replace(/^['"]|['"]$/g, '') || 'gpt-4o-mini'
const useOpenAi = process.env.USE_OPENAI === 'true'
const groqApiKey = process.env.GROQ_API_KEY?.trim().replace(/^['"]|['"]$/g, '') || ''
const groqModel = process.env.GROQ_MODEL?.trim().replace(/^['"]|['"]$/g, '') || 'llama-3.3-70b-versatile'
const useGroq = process.env.USE_GROQ === 'true'

const TODAY = new Date().toISOString().slice(0, 10)
const TARGET_INTAKE = '2027'

// ---------------------------------------------------------------------------
// Deterministic (no-AI) verification
// ---------------------------------------------------------------------------

const DET_TIMEOUT_MS = 15000
const DET_MAX_PAGES = 3

function extractText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseUrl(value) {
  if (!value) return null
  try { return new URL(value).toString() } catch { return null }
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DET_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    })
    if (!response.ok) return null
    const html = await response.text()
    const text = extractText(html)
    if (!text || text.length < 40) return null
    return { url: response.url, text }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function norm(value = '') {
  return String(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'this', 'that', 'your', 'you', 'are',
  'will', 'have', 'has', 'not', 'our', 'all', 'any', 'year', 'role', 'job', 'work',
  'within', 'across', 'about', 'their', 'they', 'its', 'was', 'were', 'been'
])

function roleTitleWords(specificRole) {
  return norm(specificRole)
    .split(' ')
    .filter(word => word.length >= 4 && !STOPWORDS.has(word))
}

function roleTitleFound(text, words) {
  if (!words.length) return false
  const present = words.filter(word => text.includes(word))
  if (words.length <= 2) return present.length === words.length
  return present.length >= Math.max(2, Math.ceil(words.length * 0.6))
}

function detectSignals(text, roleWords) {
  const lower = text.toLowerCase()
  const has2027 = /\b2027\b/.test(lower)
  const student = /industrial placement|year in industry|placement year|sandwich (?:year|placement)|internship|co-?op|undergraduate placement|student placement|12-?month placement/i.test(lower)
  const openSignal = (
    /apply (?:now|online|here|today|directly)/i.test(lower) ||
    /start (?:your )?application|submit (?:your )?application/i.test(lower) ||
    /applications? (?:are |is )?(?:now )?open/i.test(lower) ||
    /currently (?:open|recruiting|accepting applications)/i.test(lower)
  )
  const closedSignal = (
    /applications? (?:are |is |have )?(?:now )?closed/i.test(lower) ||
    /(?:vacancy|role|position|opportunity|job) (?:has |is )?(?:now )?closed/i.test(lower) ||
    /no longer accepting/i.test(lower) ||
    /deadline (?:has )?passed/i.test(lower) ||
    /position (?:has been )?filled/i.test(lower)
  )
  const titleMatched = roleTitleFound(lower, roleWords)
  return { has2027, student, openSignal, closedSignal, titleMatched }
}

// Conservative deterministic classification. OPEN_NOW and CLOSED are the only
// states we are willing to assert without an AI check; everything else is left
// unchanged rather than guessed.
function classifyDeterministic(signals) {
  const { has2027, student, openSignal, closedSignal, titleMatched } = signals
  if (has2027 && student && titleMatched && openSignal && !closedSignal) {
    return { status: 'OPEN_NOW', confidence: 0.9, mappedApplicationStatus: 'Open Now' }
  }
  if (has2027 && student && titleMatched && closedSignal && !openSignal) {
    return { status: 'CLOSED', confidence: 0.9, mappedApplicationStatus: 'Closed' }
  }
  return { status: 'UNKNOWN', confidence: 0, mappedApplicationStatus: null }
}

function deterministicEvidence(signals, mapped, pages) {
  return [
    'Deterministic verification ' + TODAY + ': ' + (mapped || 'no status change') + '.',
    '2027 mentioned: ' + (signals.has2027 ? 'yes' : 'no') +
      '; student terms: ' + (signals.student ? 'yes' : 'no') +
      '; exact role matched: ' + (signals.titleMatched ? 'yes' : 'no') +
      '; open signal: ' + (signals.openSignal ? 'yes' : 'no') +
      '; closed signal: ' + (signals.closedSignal ? 'yes' : 'no') + '.',
    'Checked URLs:\n' + pages.map(page => '- ' + page.url).join('\n')
  ].join('\n').slice(0, 4000)
}

async function verifyDeterministic(role) {
  const roleWords = roleTitleWords(role.specific_role)
  const urls = [role.application_link, role.careers_page, role.source_url]
    .map(normaliseUrl)
    .filter(Boolean)

  // Deduplicate while preserving order.
  const uniqueUrls = []
  const seen = new Set()
  for (const url of urls) {
    if (!seen.has(url)) { seen.add(url); uniqueUrls.push(url) }
  }

  if (!uniqueUrls.length) {
    return {
      ok: false,
      mode: 'deterministic',
      error: 'No fetchable URLs for this role'
    }
  }

  const checked = []
  let best = null
  let lastSignals = null

  for (const url of uniqueUrls.slice(0, DET_MAX_PAGES)) {
    const page = await fetchPage(url)
    if (!page) {
      checked.push({ url, error: 'unreachable' })
      continue
    }
    checked.push({ url: page.url, text: page.text })

    const signals = detectSignals(page.text, roleWords)
    lastSignals = signals
    const classification = classifyDeterministic(signals)

    // Prefer a decisive OPEN_NOW/CLOSED result; keep checking only until we find one.
    if (classification.mappedApplicationStatus) {
      best = { page, signals, classification }
      break
    }
  }

  const signals = best ? best.signals : (lastSignals ?? {
    has2027: false, student: false, openSignal: false, closedSignal: false, titleMatched: false
  })
  const classification = best ? best.classification : { status: 'UNKNOWN', confidence: 0, mappedApplicationStatus: null }
  const pages = checked.filter(page => page.text).map(page => ({ url: page.url }))

  const result = {
    status: classification.status,
    confidence: classification.confidence,
    intake_year: signals.has2027 ? '2027' : '',
    intake_year_confirmed: signals.has2027,
    exact_student_program_found: signals.student,
    exact_role_found: signals.titleMatched,
    direct_application_for_exact_role_found: signals.openSignal && signals.titleMatched,
    official_program_source_found: true,
    opening_date: '',
    opening_timing: '',
    deadline: '',
    deadline_type: '',
    verified_application_url: '',
    location_city: '',
    location_country: '',
    salary: '',
    degree_requirements: '',
    placement_duration: '',
    placement_type: '',
    website: '',
    evidence_summary: 'Deterministic check. ' + (classification.mappedApplicationStatus
      ? 'Strong ' + classification.mappedApplicationStatus.toLowerCase() + ' signal found.'
      : 'No strong open/closed signal found; leaving status unchanged.'),
    sources: pages.map(page => ({ url: page.url, type: 'page', evidence: 'Deterministic check' })),
    mappedApplicationStatus: classification.mappedApplicationStatus,
    evidence: deterministicEvidence(signals, classification.mappedApplicationStatus, pages)
  }

  return { ok: true, mode: 'deterministic', result }
}

// ---------------------------------------------------------------------------
// Groq (free LLM, no web-search tool) verification
// ---------------------------------------------------------------------------

const GROQ_TIMEOUT_MS = 120000
const GROQ_MAX_PAGE_CHARS = 5000
const GROQ_TOTAL_TEXT_CHARS = 14000

const groqInstructions = [
  'You are a high-precision verification agent for an engineering student placement tracker.',
  'The tracker ONLY cares about placements that START IN 2027.',
  'You are given the text of employer pages that were fetched for a specific role. Reason ONLY from the provided text. Do not invent facts, dates, or links, and do not perform any web search.',
  '',
  'Decide the availability state of the EXACT student placement / industrial placement / year-in-industry / internship / co-op / undergraduate work placement role described.',
  '',
  'States (choose exactly one):',
  'OPEN_NOW - the exact 2027 student role is currently accepting applications.',
  'OPENING_SOON - the employer explicitly states when the 2027 intake will open during 2026 (a specific date or month).',
  'EXPECTED - the employer confirms a 2027 student programme/intake but has not published opening details.',
  'NOT_YET_PUBLISHED - the employer has a student programme but the 2027 intake/opening is not published, or the intake cannot be established.',
  'CLOSED - the 2027 tracked intake is itself closed, filled, withdrawn, or expired.',
  'UNKNOWN - the evidence is insufficient or conflicting.',
  '',
  'RULES:',
  '- A closed 2026 intake does NOT mean the 2027 intake is closed. If only a closed 2026 intake appears and no 2027 intake is published, use NOT_YET_PUBLISHED (or EXPECTED if a 2027/recurring programme is confirmed).',
  '- Distinguish the application OPENING date from the placement START date. A September 2027 start is not the same as applications opening in September 2026.',
  '- Student roles only, never graduate schemes or experienced-hire jobs.',
  '- Verify the EXACT role, not a different role at the same company.',
  '- A generic Apply/Search link is not proof that the exact role is open.',
  '- If the text is insufficient, return UNKNOWN rather than guessing.',
  '',
  'Output a single JSON object with exactly these keys. Use an empty string for unknown string fields:',
  'status (one of the states above),',
  'confidence (number 0 to 1),',
  'intake_year (string, e.g. "2027" or ""),',
  'intake_year_confirmed (boolean),',
  'exact_student_program_found (boolean),',
  'exact_role_found (boolean),',
  'direct_application_for_exact_role_found (boolean),',
  'official_program_source_found (boolean),',
  'opening_date (string or ""),',
  'opening_timing (string or ""),',
  'deadline (string or ""),',
  'deadline_type (string or ""),',
  'evidence_summary (string).'
].join('\n')

async function fetchRolePages(role) {
  const urls = [role.application_link, role.careers_page, role.source_url]
    .map(normaliseUrl)
    .filter(Boolean)
  const unique = []
  const seen = new Set()
  for (const url of urls) {
    if (!seen.has(url)) { seen.add(url); unique.push(url) }
  }
  const pages = []
  for (const url of unique.slice(0, DET_MAX_PAGES)) {
    const page = await fetchPage(url)
    if (page) pages.push(page)
  }
  return pages
}

function groqEvidenceText(result, pages) {
  const parts = [
    'Groq verification ' + TODAY + ': ' + result.status + ' (' + Math.round(result.confidence * 100) + '% confidence).',
    'Student programme: ' + (result.exact_student_program_found ? 'verified' : 'not verified') + '; exact role: ' + (result.exact_role_found ? 'verified' : 'not verified') + '; 2027 intake: ' + (result.intake_year_confirmed ? 'confirmed' : 'not confirmed') + '.',
    result.evidence_summary || '',
    'Fetched pages:\n' + pages.map(page => '- ' + page.url).join('\n')
  ].filter(Boolean)
  return parts.join('\n').slice(0, 4000)
}

function normalizeGroqResult(raw, pages) {
  const validStatuses = ['OPEN_NOW', 'OPENING_SOON', 'EXPECTED', 'NOT_YET_PUBLISHED', 'CLOSED', 'UNKNOWN']
  const status = validStatuses.includes(raw?.status) ? raw.status : 'UNKNOWN'
  const confidence = Number.isFinite(Number(raw?.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0
  const bool = value => value === true || value === 'true' || value === 1 || value === '1'
  const str = value => (typeof value === 'string' ? value : '')
  const dateLike = value => /\b(20\d\d|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/i.test(value)

  const opening_date = dateLike(str(raw?.opening_date)) ? str(raw.opening_date) : ''
  const deadline = dateLike(str(raw?.deadline)) ? str(raw.deadline) : ''
  const deadline_type = ['Rolling', 'Fixed', 'TBC'].includes(str(raw?.deadline_type)) ? str(raw.deadline_type) : ''

  const result = {
    status,
    confidence,
    intake_year: str(raw?.intake_year),
    intake_year_confirmed: bool(raw?.intake_year_confirmed),
    exact_student_program_found: bool(raw?.exact_student_program_found),
    exact_role_found: bool(raw?.exact_role_found),
    direct_application_for_exact_role_found: bool(raw?.direct_application_for_exact_role_found),
    official_program_source_found: bool(raw?.official_program_source_found),
    opening_date,
    opening_timing: str(raw?.opening_timing),
    deadline,
    deadline_type,
    verified_application_url: '',
    location_city: '',
    location_country: '',
    salary: '',
    degree_requirements: '',
    placement_duration: '',
    placement_type: '',
    website: '',
    evidence_summary: str(raw?.evidence_summary),
    sources: pages.map(page => ({ url: page.url, type: 'page', evidence: 'Fetched page provided to Groq' }))
  }

  result.mappedApplicationStatus = mapToApplicationStatus(result)
  result.evidence = groqEvidenceText(result, pages)
  return result
}

async function verifyWithGroq(role) {
  if (!groqApiKey) {
    return { ok: false, mode: 'groq', error: 'USE_GROQ=true but GROQ_API_KEY is missing' }
  }

  const pages = await fetchRolePages(role)
  if (!pages.length) {
    return { ok: false, mode: 'groq', error: 'No fetchable pages for this role' }
  }

  const pageText = pages
    .map(page => '### ' + page.url + '\n' + page.text.slice(0, GROQ_MAX_PAGE_CHARS))
    .join('\n\n')
    .slice(0, GROQ_TOTAL_TEXT_CHARS)

  const userPrompt = [
    'Current date: ' + TODAY,
    'Target placement start intake: 2027',
    '',
    'Company: ' + (role.company ?? ''),
    'Role: ' + (role.specific_role ?? ''),
    'Location: ' + [role.city, role.country].filter(Boolean).join(', '),
    'Engineering area: ' + (role.engineering_area ?? role.department ?? ''),
    'Currently recorded application status: ' + (role.application_status ?? ''),
    '',
    'Fetched page text (reason ONLY from this):',
    pageText
  ].join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + groqApiKey
      },
      body: JSON.stringify({
        model: groqModel,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: groqInstructions },
          { role: 'user', content: userPrompt }
        ]
      })
    })

    const body = await response.json()
    if (!response.ok) {
      throw new Error(body?.error?.message || ('Groq HTTP ' + response.status))
    }
    const content = body?.choices?.[0]?.message?.content
    if (!content) throw new Error('Groq returned no content')

    let raw
    try { raw = JSON.parse(content) } catch { throw new Error('Groq returned invalid JSON') }

    const result = normalizeGroqResult(raw, pages)
    return { ok: true, mode: 'groq', result }
  } catch (error) {
    return { ok: false, mode: 'groq', error: error?.message ?? String(error) }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// AI (opt-in) verification
// ---------------------------------------------------------------------------

const MAX_WEB_SEARCHES = 10
const MAX_OUTPUT_TOKENS = 2400
const REQUEST_TIMEOUT_MS = 120000

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['OPEN_NOW', 'OPENING_SOON', 'EXPECTED', 'NOT_YET_PUBLISHED', 'CLOSED', 'UNKNOWN']
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    intake_year: { type: 'string' },
    intake_year_confirmed: { type: 'boolean' },
    exact_student_program_found: { type: 'boolean' },
    exact_role_found: { type: 'boolean' },
    direct_application_for_exact_role_found: { type: 'boolean' },
    official_program_source_found: { type: 'boolean' },
    opening_date: { type: 'string' },
    opening_timing: { type: 'string' },
    deadline: { type: 'string' },
    deadline_type: { type: 'string' },
    verified_application_url: { type: 'string' },
    location_city: { type: 'string' },
    location_country: { type: 'string' },
    salary: { type: 'string' },
    degree_requirements: { type: 'string' },
    placement_duration: { type: 'string' },
    placement_type: { type: 'string' },
    website: { type: 'string' },
    evidence_summary: { type: 'string' },
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
    'intake_year',
    'intake_year_confirmed',
    'exact_student_program_found',
    'exact_role_found',
    'direct_application_for_exact_role_found',
    'official_program_source_found',
    'opening_date',
    'opening_timing',
    'deadline',
    'deadline_type',
    'verified_application_url',
    'location_city',
    'location_country',
    'salary',
    'degree_requirements',
    'placement_duration',
    'placement_type',
    'website',
    'evidence_summary',
    'sources'
  ]
}

const instructions = [
  'You are the high-precision verification agent for an engineering student placement tracker.',
  'The tracker ONLY cares about placements that START IN 2027 (a 2027 intake). Do not reclassify a role based on a 2026 or earlier intake.',
  '',
  'Decide the availability state of the EXACT STUDENT PLACEMENT / INDUSTRIAL PLACEMENT / YEAR-IN-INDUSTRY / INTERNSHIP / CO-OP / UNDERGRADUATE WORK PLACEMENT role you are given. Never decide based on a different role at the same company.',
  '',
  'STATES:',
  'OPEN_NOW - the exact 2027 student role is currently accepting applications on the current date.',
  'OPENING_SOON - the employer explicitly confirms the relevant 2027 intake and states when it will open during 2026 (a specific date or month, e.g. "opens September 2026"). Use this only when the opening timing is established.',
  'EXPECTED - the employer confirms a future 2027 student programme/intake (or a clearly recurring annual programme) but has not yet published opening details for the 2027 intake.',
  'NOT_YET_PUBLISHED - the employer has a relevant student programme, but the 2027 intake/opening has not been published, or the current intake cannot be established from evidence.',
  'CLOSED - reliable current evidence establishes that the relevant 2027 tracked intake is itself closed, filled, withdrawn, or expired, AND there is no stronger evidence that the next relevant intake is open/about to open.',
  'UNKNOWN - the evidence is insufficient or conflicting. Prefer UNKNOWN over a guess.',
  '',
  'CRITICAL TIMING RULE: a listing or notice that says applications for a 2026 intake are closed is NOT evidence that the 2027 intake is closed. If the employer only shows a closed 2026 intake and has not published the 2027 intake, that is NOT_YET_PUBLISHED (or EXPECTED if the employer confirms the 2027/recurring programme), never CLOSED. Distinguish the application OPENING date from the placement START date: a September 2027 start is not the same as applications opening in September 2026.',
  '',
  'STUDENT-ONLY RULE: verify this is genuinely a student opportunity (industrial placement, year in industry, internship, co-op, undergraduate placement). Graduate schemes, experienced-hire vacancies, apprenticeships that are not degree placements, insight events, and summer internships that do not lead into a 2027 placement do not qualify. If you cannot confirm it is a student placement, return UNKNOWN with exact_student_program_found=false.',
  '',
  'EXACT-ROLE RULE: you must verify THIS role at THIS company, not a sibling role. A generic Apply/Search/View-jobs button is NOT evidence. If it opens a job board, inspect that board and find the exact role; if it is absent from the first page, do not conclude OPEN or CLOSED - the board may be paginated, filtered, or dynamically loaded. Use the board search/filter and pagination controls, and search the exact role title plus student terms (intern, internship, placement, industrial placement, year in industry, student, undergraduate) on the employer site.',
  '',
  'OPEN_NOW requires ALL of: (1) relevant student programme identified; (2) 2027 intake identified; (3) the exact tracked role present on the current employer vacancy/job-board results or the employer explicitly says this exact role/programme is accepting applications; (4) direct application evidence for that exact role; (5) an official employer source; (6) no stronger closed/expired evidence. Set direct_application_for_exact_role_found only when you found the actual application entry for the exact role.',
  '',
  'CLOSED applies only when the exact 2027 role/intake is itself closed/filled/expired/withdrawn or the deadline has passed. An expired 2026 page alone never closes the 2027 intake.',
  '',
  'SOURCE PRIORITY: prefer the employer official student-programme page, official job board, and official exact-vacancy page. Secondary aggregators (Gradcracker, etc.) may corroborate or provide leads but are not authoritative for availability. Never infer availability from HTTP 200, page existence, or a generic careers page.',
  '',
  'DO NOT invent dates, links, salaries, or requirements. Leave a field as an empty string when the evidence does not establish it. Set verified_application_url only to a URL you actually confirmed is the application page for the exact 2027 role.',
  '',
  'SEARCH BUDGET: you have up to ' + MAX_WEB_SEARCHES + ' web searches. Start with the exact role and official employer domain, then the employer student programme, then the job board/search and targeted student keywords. Resolve conflicts with the most authoritative/current source. If the intake or availability cannot be established, return UNKNOWN or NOT_YET_PUBLISHED as appropriate rather than guessing.',
  '',
  'Return only the structured result.'
].join('\n')

function knownLinks(role) {
  return [role.application_link, role.careers_page, role.source_url]
    .map(normaliseUrl)
    .filter(Boolean)
}

function buildPrompt(role) {
  const urls = knownLinks(role)
  return [
    'Current date: ' + TODAY,
    'Target placement start intake: ' + TARGET_INTAKE,
    '',
    'Company: ' + (role.company ?? ''),
    'Role: ' + (role.specific_role ?? ''),
    'Location: ' + [role.city, role.country].filter(Boolean).join(', '),
    'Engineering area: ' + (role.engineering_area ?? role.department ?? ''),
    'Currently recorded application status: ' + (role.application_status ?? ''),
    '',
    'Known URLs:',
    urls.length ? urls.map(url => '- ' + url).join('\n') : '- none',
    '',
    'Investigate the exact role and its 2027 intake as described in your instructions. Remember: a closed 2026 intake does not close the 2027 intake. Return OPEN_NOW only with direct application evidence for the exact 2027 role; otherwise use OPENING_SOON, EXPECTED, NOT_YET_PUBLISHED, CLOSED (only when the 2027 intake itself is closed), or UNKNOWN.'
  ].join('\n')
}

function validate(result) {
  const validStatuses = ['OPEN_NOW', 'OPENING_SOON', 'EXPECTED', 'NOT_YET_PUBLISHED', 'CLOSED', 'UNKNOWN']
  if (!validStatuses.includes(result.status)) return 'Invalid status: ' + result.status
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    return 'Invalid confidence'
  }
  return null
}

async function ask(role) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + openAiKey
      },
      body: JSON.stringify({
        model,
        max_tool_calls: MAX_WEB_SEARCHES,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [{ type: 'web_search' }],
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: instructions }] },
          { role: 'user', content: [{ type: 'input_text', text: buildPrompt(role) }] }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'placement_2027_availability',
            strict: true,
            schema
          }
        }
      })
    })

    const body = await response.json()
    if (!response.ok) {
      throw new Error(body?.error?.message || ('OpenAI HTTP ' + response.status))
    }
    if (!body?.output_text) throw new Error('OpenAI returned no output_text')

    let result
    try {
      result = JSON.parse(body.output_text)
    } catch {
      throw new Error('OpenAI returned invalid JSON')
    }

    const invalid = validate(result)
    if (invalid) throw new Error('Invalid verification result: ' + invalid)
    return result
  } finally {
    clearTimeout(timer)
  }
}

function intakeIs2027(intakeYear) {
  return /\b2027\b/.test(String(intakeYear ?? ''))
}

function mapToApplicationStatus(result) {
  if (!result || result.exact_student_program_found !== true) return null

  const confidence = result.confidence
  const intake2027 = result.intake_year_confirmed === true && intakeIs2027(result.intake_year)

  switch (result.status) {
    case 'OPEN_NOW':
      if (
        confidence >= 0.88 &&
        intake2027 &&
        result.exact_role_found === true &&
        result.direct_application_for_exact_role_found === true &&
        result.official_program_source_found === true
      ) return 'Open Now'
      return null

    case 'OPENING_SOON':
      if (
        confidence >= 0.78 &&
        intake2027 &&
        (result.opening_date || result.opening_timing)
      ) return 'Opening Soon'
      return null

    case 'EXPECTED':
      if (confidence >= 0.7 && intake2027) return 'Expected'
      return null

    case 'NOT_YET_PUBLISHED':
      if (confidence >= 0.65) return intake2027 ? 'Expected' : 'Not Yet Published'
      return null

    case 'CLOSED':
      if (confidence >= 0.88 && intake2027) return 'Closed'
      return null

    default:
      return null
  }
}

function evidenceText(result) {
  const sources = (result.sources ?? [])
    .filter(source => source?.url)
    .slice(0, 5)
    .map(source => (source.type || 'source') + ': ' + source.url + ' — ' + (source.evidence || ''))
    .join(' | ')
  const parts = [
    'Verification ' + TODAY + ': ' + result.status + ' (' + Math.round(result.confidence * 100) + '% confidence).',
    'Student programme: ' + (result.exact_student_program_found ? 'verified' : 'not verified') + '; exact role: ' + (result.exact_role_found ? 'verified' : 'not verified') + '; 2027 intake: ' + (result.intake_year_confirmed ? 'confirmed' : 'not confirmed') + '.',
    'Direct exact-role application: ' + (result.direct_application_for_exact_role_found ? 'verified' : 'not verified') + '; official source: ' + (result.official_program_source_found ? 'verified' : 'not verified') + '.',
    result.evidence_summary || '',
    sources ? 'Evidence: ' + sources : ''
  ].filter(Boolean)
  return parts.join('\n').slice(0, 4000)
}

async function verifyWithAi(role) {
  if (!openAiKey) {
    return { ok: false, mode: 'ai', error: 'USE_OPENAI=true but OPENAI_API_KEY is missing' }
  }
  try {
    const result = await ask(role)
    return {
      ok: true,
      mode: 'ai',
      result: {
        ...result,
        mappedApplicationStatus: mapToApplicationStatus(result),
        evidence: evidenceText(result)
      }
    }
  } catch (error) {
    return { ok: false, mode: 'ai', error: error?.message ?? String(error) }
  }
}

// Public entry point. Returns { ok, mode, result? , error? }.
export async function verifyPlacement(role) {
  if (useGroq) return verifyWithGroq(role)
  if (useOpenAi) return verifyWithAi(role)
  return verifyDeterministic(role)
}

export { TODAY, TARGET_INTAKE, model, useOpenAi, useGroq, groqModel }
