// Discover NEW 2027-start student placements for aerospace / space / motorsport /
// general engineering students, rigorously verify each candidate, and insert only
// confirmed, valid entries. Existing rows are left to the audit script; Not Interested
// rows are never recreated.
//
// No subjective scoring is fabricated here: CV-fit, relevance, priority and
// "why it fits" fields are left null for the user to assess.

import { createClient } from '@supabase/supabase-js'
import { verifyPlacement, TODAY, model } from './placement-verifier.mjs'

const rawSupabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')

if (!rawSupabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!openAiKey) {
  console.error('Missing OPENAI_API_KEY.')
  process.exit(1)
}

const supabaseUrl = new URL(rawSupabaseUrl)
supabaseUrl.pathname = ''
supabaseUrl.search = ''
supabaseUrl.hash = ''

const supabase = createClient(supabaseUrl.toString().replace(/\/$/, ''), supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false }
})

const DISCOVERY_QUERIES = [
  '2027 aerospace engineering industrial placement year in industry student',
  '2027 space systems rocket satellite engineering placement internship student',
  '2027 motorsport Formula 1 engineering placement year in industry student',
  '2027 mechanical engineering industrial placement year in industry',
  '2027 electrical electronic systems engineering placement student',
  '2027 engineering placement internship student aerospace defence Europe UK',
  '2027 manufacturing engineering placement student UK',
  '2027 aerodynamics CFD propulsion engineering placement internship'
]

const MAX_DISCOVERY_SEARCHES = 4
const MAX_CANDIDATES_PER_QUERY = 15
const MAX_TOTAL_CANDIDATES = 80
const MAX_CONCURRENT = 2
const DELAY_MS = 350

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const discoverySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          company: { type: 'string' },
          specific_role: { type: 'string' },
          sector: { type: 'string' },
          country: { type: 'string' },
          city: { type: 'string' },
          placement_type: { type: 'string' },
          intake_year: { type: 'string' },
          application_link: { type: 'string' },
          careers_page: { type: 'string' },
          opening_note: { type: 'string' }
        },
        required: [
          'company', 'specific_role', 'sector', 'country', 'city',
          'placement_type', 'intake_year', 'application_link', 'careers_page', 'opening_note'
        ]
      }
    }
  },
  required: ['candidates']
}

const discoveryInstructions = [
  'You are a discovery agent for an engineering student placement tracker that ONLY tracks placements STARTING IN 2027.',
  'Find NEW, specific student placement / industrial placement / year-in-industry / internship / co-op opportunities in aerospace, space, rockets, satellites, motorsport (Formula 1 and comparable series), and general engineering (mechanical, electrical/electronic, systems, manufacturing, aerodynamics/CFD, propulsion, controls/avionics).',
  '',
  'RULES:',
  '- Only student roles, never graduate schemes or experienced-hire jobs.',
  '- Prefer roles whose 2027 intake is live, about to open, or confirmed as expected.',
  '- A role is still a valid 2027 lead if the employer page explains that the 2027 intake opens later in 2026; include it and note the opening timing.',
  '- Use official employer pages when possible; aggregators (e.g. Gradcracker) are acceptable leads but note them.',
  '- Do NOT include roles that are clearly 2026 intake only.',
  '- For each candidate return the company, exact role title, sector, country, city (empty if unknown), placement type, intake year (2027 when known, empty otherwise), an application or careers link, and a one-line opening note.',
  '',
  'Return up to ' + MAX_CANDIDATES_PER_QUERY + ' distinct candidates per search. Do not fabricate links or details; use an empty string when a field is unknown.'
].join('\n')

function norm(value = '') {
  return String(value).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function roleKey(c) {
  return `${norm(c.company)}|${norm(c.specific_role)}`
}

function candidateHas2027(c) {
  const intake = String(c.intake_year ?? '')
  return intake === '' || /\b2027\b/.test(intake)
}

async function discoverOnce(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
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
        max_tool_calls: MAX_DISCOVERY_SEARCHES,
        max_output_tokens: 4000,
        tools: [{ type: 'web_search' }],
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: discoveryInstructions }] },
          { role: 'user', content: [{ type: 'input_text', text: 'Search now and return 2027-start student placement candidates for this theme: ' + query }] }
        ],
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'placement_discovery_candidates',
            strict: true,
            schema: discoverySchema
          }
        }
      })
    })

    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || ('OpenAI HTTP ' + response.status))
    if (!body?.output_text) throw new Error('OpenAI returned no output_text')

    const parsed = JSON.parse(body.output_text)
    return Array.isArray(parsed?.candidates) ? parsed.candidates : []
  } finally {
    clearTimeout(timer)
  }
}

async function loadExistingIndex() {
  const { data, error } = await supabase
    .from('placements')
    .select('id, company, specific_role, city, application_link, not_interested')

  if (error) throw error

  const byKey = new Map()
  const byUrl = new Map()
  const notInterested = new Map()

  for (const row of (data ?? [])) {
    const key = `${norm(row.company)}|${norm(row.specific_role)}`
    byKey.set(key, row)
    const urls = [row.application_link].filter(Boolean)
    for (const url of urls) {
      try { byUrl.set(new URL(url).toString(), row) } catch {}
    }
    if (row.not_interested === true) notInterested.set(key, row)
  }

  return { byKey, byUrl, notInterested }
}

function buildInsert(candidate, result) {
  const mapped = result.mappedApplicationStatus
  return {
    company: candidate.company,
    sector: candidate.sector || null,
    country: result.location_country || candidate.country || null,
    city: result.location_city || candidate.city || null,
    website: result.website || null,
    careers_page: candidate.careers_page || candidate.application_link || null,
    specific_role: candidate.specific_role,
    department: null,
    engineering_area: null,
    placement_type: result.placement_type || candidate.placement_type || null,
    placement_duration: result.placement_duration || null,
    application_status: mapped,
    exact_opening_date: result.opening_date || null,
    exact_deadline: result.deadline || null,
    deadline_type: result.deadline_type || null,
    date_info_verified: 'Verified ' + TODAY + ' during automated 2027 discovery',
    application_link: result.verified_application_url || candidate.application_link || candidate.careers_page || null,
    degree_requirements: result.degree_requirements || null,
    salary: result.salary || null,
    salary_period: null,
    // Subjective fit fields are deliberately left null (the user assesses these).
    app_status: 'Not Applied',
    source_url: candidate.application_link || candidate.careers_page || null,
    source_type: 'Automated discovery',
    source_date_checked: TODAY,
    source_verified: result.evidence
  }
}

async function main() {
  console.log('Discovery started. Model:', model)

  const { byKey, byUrl, notInterested } = await loadExistingIndex()
  console.log(`Existing index: ${byKey.size} company/role keys loaded.`)

  // 1. Collect candidates.
  const rawCandidates = []
  const seenRaw = new Set()
  for (const query of DISCOVERY_QUERIES) {
    try {
      const found = await discoverOnce(query)
      for (const c of found) {
        if (rawCandidates.length >= MAX_TOTAL_CANDIDATES) break
        if (!c.company || !c.specific_role) continue
        if (!candidateHas2027(c)) continue
        const key = roleKey(c)
        if (seenRaw.has(key)) continue
        seenRaw.add(key)
        rawCandidates.push({ ...c, _query: query })
      }
      console.log(`Discovery query "${query}": ${found.length} candidates`)
    } catch (error) {
      console.error(`Discovery query failed: ${query}: ${error?.message ?? error}`)
    }
    await sleep(DELAY_MS)
  }

  console.log(`Total unique discovery candidates: ${rawCandidates.length}`)

  // 2. Verify and insert.
  let inserted = 0
  let rejected = 0
  let skippedExisting = 0
  let skippedNotInterested = 0
  let errors = 0

  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= rawCandidates.length) return
      const candidate = rawCandidates[index]

      const key = roleKey(candidate)
      if (notInterested.has(key)) {
        skippedNotInterested++
        console.log(`SKIPPED (Not Interested): ${candidate.company} — ${candidate.specific_role}`)
        return
      }
      if (byKey.has(key)) {
        skippedExisting++
        console.log(`SKIPPED (already tracked): ${candidate.company} — ${candidate.specific_role}`)
        return
      }

      const verification = await verifyPlacement(candidate)
      if (!verification.ok) {
        errors++
        console.error(`VERIFICATION ERROR: ${candidate.company} — ${candidate.specific_role}: ${verification.error}`)
        return
      }

      const result = verification.result
      const mapped = result.mappedApplicationStatus
      const intake2027 = result.intake_year_confirmed === true && /\b2027\b/.test(String(result.intake_year ?? ''))
      const link = result.verified_application_url || candidate.application_link || candidate.careers_page || ''

      const valid = (
        result.exact_student_program_found === true &&
        result.exact_role_found === true &&
        intake2027 &&
        Boolean(link) &&
        ['Open Now', 'Opening Soon', 'Expected', 'Not Yet Published'].includes(mapped)
      )

      if (!valid) {
        rejected++
        console.log(`REJECTED (not a confirmed 2027 student role): ${candidate.company} — ${candidate.specific_role} [${result.status}]`)
        return
      }

      // Re-check URL-level dedupe just before insert (a previous candidate may have
      // inserted the same application link this run).
      if (byUrl.has(link)) {
        skippedExisting++
        console.log(`SKIPPED (same application link already tracked): ${candidate.company} — ${candidate.specific_role}`)
        return
      }

      const placement = buildInsert(candidate, result)
      const { error } = await supabase.from('placements').insert(placement)
      if (error) {
        errors++
        console.error(`INSERT FAILED: ${candidate.company} — ${candidate.specific_role}: ${error.message}`)
        return
      }

      inserted++
      if (link) byUrl.set(link, candidate)
      byKey.set(key, candidate)
      console.log(`NEW ROLE: ${candidate.company} — ${candidate.specific_role} [${mapped}] ${link || ''}`)
      await sleep(DELAY_MS)
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, rawCandidates.length) }, worker))

  console.log(`DISCOVERY COMPLETE: ${inserted} new, ${rejected} rejected (not confirmed 2027 student roles), ${skippedExisting} already tracked, ${skippedNotInterested} Not Interested skipped, ${errors} errors.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
