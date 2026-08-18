// Shared high-precision verifier for the placement maintenance pipeline.
//
// This module is intentionally side-effect free: it only calls OpenAI and returns
// a structured result. The discovery and audit scripts decide what to write to the
// database. The tracked intake is 2027 (placements that START in 2027).

const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim().replace(/^['"]|['"]$/g, '') || 'gpt-4o-mini'

if (!openAiKey) {
  console.error('Missing OPENAI_API_KEY. Set it as a GitHub Actions secret (or env var).')
  process.exit(1)
}

const TODAY = new Date().toISOString().slice(0, 10)
const TARGET_INTAKE = '2027'

const MAX_WEB_SEARCHES = 10
const MAX_OUTPUT_TOKENS = 2400
const REQUEST_TIMEOUT_MS = 120000

// Availability state machine. The app's application_status only accepts:
// 'Open Now' | 'Opening Soon' | 'Expected' | 'Not Yet Published' | 'Closed'.
// The verifier can also return UNKNOWN, which means "leave the existing value alone".
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

// Ordinary quoted strings joined together (no backticks inside the prompt).
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

function normaliseUrl(value) {
  if (!value) return null
  try { return new URL(value).toString() } catch { return null }
}

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
        reasoning: { effort: 'medium' },
        max_tool_calls: MAX_WEB_SEARCHES,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [{ type: 'web_search' }],
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: instructions }] },
          { role: 'user', content: [{ type: 'input_text', text: buildPrompt(role) }] }
        ],
        text: {
          verbosity: 'medium',
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

// Map a verified result to one of the app's 5 statuses, or null to leave the
// existing value untouched. Every mapping requires the student programme to be
// established so a non-student/expired result can never flip a card.
export function mapToApplicationStatus(result) {
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
      // A known student programme whose 2027 intake is not yet published, OR a
      // closed 2026 intake with no 2027 intake published yet. When the 2027 intake
      // IS confirmed but opening details are missing, that is "Expected".
      if (confidence >= 0.65) return intake2027 ? 'Expected' : 'Not Yet Published'
      return null

    case 'CLOSED':
      // Only close the card when the 2027 intake itself is confirmed and closed.
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

// Public entry point. Returns { ok: true, result } on success or { ok: false, error }.
export async function verifyPlacement(role) {
  try {
    const result = await ask(role)
    return {
      ok: true,
      result: {
        ...result,
        mappedApplicationStatus: mapToApplicationStatus(result),
        evidence: evidenceText(result)
      }
    }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) }
  }
}

export { TODAY, TARGET_INTAKE, model }
