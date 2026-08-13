import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')

if (!rawSupabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY GitHub Actions secrets.')
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
  console.error(`Invalid SUPABASE_URL secret: ${rawSupabaseUrl}`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false },
})

const today = new Date().toISOString().slice(0, 10)
const timeoutMs = 20000

function normaliseUrl(value) {
  if (!value) return null
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

function cleanText(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 placement-tracker/1.2',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    const html = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      html,
      text: cleanText(html),
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      html: '',
      text: '',
      error: error?.message ?? 'Unknown error',
    }
  } finally {
    clearTimeout(timer)
  }
}

/*
 * A careers landing page is NOT evidence that a placement is accepting
 * applications. More importantly, even a job-specific careers page is not
 * enough if the job on that page is a normal graduate/permanent role.
 *
 * Open Now therefore requires BOTH:
 *   1. a job/application-specific page; and
 *   2. evidence that the page itself describes the tracked industrial
 *      placement/internship role.
 */
function isGenericCareersPage(url) {
  if (!url) return true

  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase()

    const genericPatterns = [
      /(^|\/)careers?(\/|$)/,
      /(^|\/)early[-_ ]?careers?(\/|$)/,
      /(^|\/)students?(\/|$)/,
      /(^|\/)graduates?(\/|$)/,
      /(^|\/)internships?(\/|$)/,
      /(^|\/)intern[-_ ]?programs?(\/|$)/,
      /(^|\/)placements?(\/|$)/,
      /(^|\/)jobs?(\/|$)$/,
      /(^|\/)search[-_ ]?(jobs?|all)(\/|$)/,
      /(^|\/)job[-_ ]?search(\/|$)/,
    ]

    if (/gradcracker\.com\/hub\/\d+\/[^/]+\/(?:work-placement-internship|job)\/\d+/i.test(url)) {
      return false
    }

    return genericPatterns.some((pattern) => pattern.test(path))
  } catch {
    return true
  }
}

function normaliseSearchText(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasIndustrialPlacementEvidence(text) {
  const industrialPatterns = [
    /industrial placement/,
    /year in industry/,
    /year in industry placement/,
    /sandwich placement/,
    /sandwich year/,
    /student placement/,
    /university placement/,
    /undergraduate placement/,
    /engineering placement/,
    /work placement/,
    /12 month placement/,
    /12 month internship/,
    /placement student/,
    /placement year/,
    /co op/,
    /cooperative education/,
    /internship/,
    /intern/,
  ]

  return industrialPatterns.some((pattern) => pattern.test(text))
}

function roleMatchesPage(text, specificRole) {
  const role = normaliseSearchText(specificRole)
  if (!role) return false

  const page = normaliseSearchText(text)
  if (!page) return false

  // Avoid requiring every word: role titles often contain location, grade,
  // punctuation or internal reference numbers that are absent from the page.
  const stopWords = new Set([
    'and', 'the', 'for', 'with', 'this', 'year', 'student', 'students',
    'placement', 'industrial', 'internship', 'intern', 'engineering',
    'undergraduate', 'university', 'co', 'op', 'uk', 'europe', 'global',
  ])

  const tokens = role.split(' ').filter((token) => token.length >= 4 && !stopWords.has(token))
  if (!tokens.length) return hasIndustrialPlacementEvidence(page)

  const meaningfulMatches = tokens.filter((token) => page.includes(token))
  return meaningfulMatches.length >= Math.min(2, tokens.length)
}

function isRelevantIndustrialPlacementPage({ text, specificRole }) {
  const page = normaliseSearchText(text)
  return hasIndustrialPlacementEvidence(page) && roleMatchesPage(page, specificRole)
}

function hasStrongOpenSignal(text) {
  return [
    /apply\s+now\b/,
    /apply\s+for\s+this\s+(?:job|position|role)\b/,
    /submit\s+(?:your\s+)?application\b/,
    /applications?\s+(?:are\s+)?open\b/,
    /applications?\s+(?:are\s+)?being accepted\b/,
    /apply\s+online\b/,
    /start\s+(?:your\s+)?application\b/,
    /start\s+application\b/,
  ].some((pattern) => pattern.test(text))
}

function hasStrongClosedSignal(text) {
  return [
    /applications?\s+(?:are\s+)?closed\b/,
    /applications?\s+(?:are\s+)?no longer (?:being )?accepted\b/,
    /no longer accepting applications?\b/,
    /this (?:job|position|vacancy|role)\s+(?:has\s+)?(?:been\s+)?filled\b/,
    /this (?:job|position|vacancy|role)\s+is\s+closed\b/,
    /(?:job|position|vacancy|role)\s+closed\b/,
    /(?:job|position|vacancy|role)\s+is no longer available\b/,
    /applications?\s+have\s+closed\b/,
    /the application deadline has passed\b/,
    /recruitment for this (?:role|position) has closed\b/,
  ].some((pattern) => pattern.test(text))
}

function detectApplicationStatus({ url, text, specificRole }) {
  const clean = cleanText(text).toLowerCase()

  if (!clean || isGenericCareersPage(url)) return null

  // Critical safeguard: a different job going live must never open the
  // tracked industrial placement. The actual page must contain placement /
  // internship evidence AND match the tracked role sufficiently.
  if (!isRelevantIndustrialPlacementPage({ text: clean, specificRole })) return null

  // Closed takes precedence if a page contains stale "apply" text alongside
  // an explicit closure message.
  if (hasStrongClosedSignal(clean)) return 'Closed'
  if (hasStrongOpenSignal(clean)) return 'Open Now'

  return null
}

function synchroniseState(placement, detectedStatus) {
  if (!detectedStatus) return {}

  const priority = String(placement.overall_priority ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')

  const updates = {
    application_status: detectedStatus,
  }

  if (
    detectedStatus === 'Open Now' &&
    (priority === 'HIGH_PRIORITY_WATCH' || priority === 'APPLY_WHEN_OPENING')
  ) {
    updates.overall_priority = 'APPLY_IMMEDIATELY'
  }

  return updates
}

function conservativeStatusAfterUnverifiedOpen(placement) {
  if (placement.application_status !== 'Open Now') return null
  return 'Expected'
}

async function main() {
  console.log(`Using Supabase project: ${new URL(supabaseUrl).hostname}`)

  const { data: placements, error } = await supabase
    .from('placements')
    .select(`
      id,
      company,
      specific_role,
      application_status,
      application_link,
      careers_page,
      source_url,
      source_verified,
      overall_priority
    `)

  if (error) {
    console.error('Supabase query failed:', error)
    throw error
  }

  console.log(`Checking ${placements?.length ?? 0} tracked opportunities...`)

  let checked = 0
  let unreachable = 0
  let opened = 0
  let closed = 0
  let resetUnverified = 0
  let priorityUpdated = 0
  let inconclusive = 0

  for (const placement of placements ?? []) {
    const applicationLink = normaliseUrl(placement.application_link)
    const candidates = [
      placement.application_link,
      placement.careers_page,
      placement.source_url,
    ]
      .map(normaliseUrl)
      .filter(Boolean)

    if (!candidates.length) continue

    let result = null
    let checkedUrl = null

    const orderedCandidates = applicationLink
      ? [applicationLink, ...candidates.filter((url) => url !== applicationLink)]
      : candidates

    for (const url of orderedCandidates) {
      result = await fetchPage(url)
      checkedUrl = url
      if (result.ok) break
    }

    checked++

    const statusText = result?.ok
      ? `URL reachable (${result.status})`
      : `URL check failed${result?.status ? ` (${result.status})` : ''}`

    const updates = {
      source_date_checked: today,
      source_verified: `${statusText}; automatically checked ${today}`,
      updated_at: new Date().toISOString(),
    }

    const checkedApplicationPage = Boolean(
      applicationLink &&
      checkedUrl === applicationLink &&
      result?.ok
    )

    let detectedStatus = null

    if (checkedApplicationPage) {
      detectedStatus = detectApplicationStatus({
        url: checkedUrl,
        text: result.text,
        specificRole: placement.specific_role,
      })

      if (detectedStatus) {
        const previousPriority = placement.overall_priority
        const stateUpdates = synchroniseState(placement, detectedStatus)
        Object.assign(updates, stateUpdates)

        if (detectedStatus === 'Open Now') opened++
        else if (detectedStatus === 'Closed') closed++

        if (
          stateUpdates.overall_priority === 'APPLY_IMMEDIATELY' &&
          previousPriority !== 'APPLY_IMMEDIATELY'
        ) {
          priorityUpdated++
        }

        console.log(
          `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
          `${placement.application_status ?? 'TBC'} → ${detectedStatus}` +
          `${stateUpdates.overall_priority ? `; priority → ${stateUpdates.overall_priority}` : ''}`
        )
      } else {
        inconclusive++
        const conservativeStatus = conservativeStatusAfterUnverifiedOpen(placement)
        if (conservativeStatus) {
          updates.application_status = conservativeStatus
          resetUnverified++
          console.log(
            `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
            'Open Now could not be proven for the tracked industrial placement; resetting to Expected'
          )
        } else {
          console.log(
            `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
            'application status inconclusive; leaving status unchanged'
          )
        }
      }
    } else if (placement.application_status === 'Open Now') {
      updates.application_status = 'Expected'
      resetUnverified++
      console.log(
        `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
        'Open Now could not be verified; resetting to Expected'
      )
    } else {
      inconclusive++
    }

    if (!result?.ok) {
      unreachable++
      updates.notes =
        `Automated monitor: tracked URL could not be reached on ${today}. ` +
        `${result?.error ?? ''}`.trim()
    }

    const { error: updateError } = await supabase
      .from('placements')
      .update(updates)
      .eq('id', placement.id)

    if (updateError) {
      console.error(
        `Failed updating ${placement.company} — ${placement.specific_role}:`,
        updateError.message
      )
    }
  }

  console.log(
    `Monitor complete: ${checked} checked, ` +
    `${opened} proven open, ${closed} proven closed, ` +
    `${resetUnverified} stale/unverified Open Now rows reset, ` +
    `${priorityUpdated} priority updates, ` +
    `${inconclusive} inconclusive, ${unreachable} unreachable.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
