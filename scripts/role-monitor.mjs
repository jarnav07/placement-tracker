import { createClient } from '@supabase/supabase-js'

// Accept either a normal Supabase project URL or a URL accidentally copied
// with /rest/v1 appended. supabase-js expects the project URL as its base.
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
        'User-Agent': 'Mozilla/5.0 placement-tracker/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    const html = await response.text()

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      text: cleanText(html),
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      text: '',
      error: error?.message ?? 'Unknown error',
    }
  } finally {
    clearTimeout(timer)
  }
}

/*
 * Determine application availability from the actual application page.
 *
 * A URL returning HTTP 200 is NOT enough: many employers keep a permanent
 * careers/ATS URL alive after a vacancy closes. We therefore look for strong
 * page-level signals and return null when the page is inconclusive.
 */
function detectApplicationStatus(pageText) {
  const text = cleanText(pageText).toLowerCase()

  if (!text) return null

  const closedSignals = [
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
  ]

  if (closedSignals.some((pattern) => pattern.test(text))) {
    return 'Closed'
  }

  const openSignals = [
    /apply now\b/,
    /apply for this (?:job|position|role)\b/,
    /submit (?:your )?application\b/,
    /applications?\s+(?:are\s+)?open\b/,
    /applications?\s+(?:are\s+)?being accepted\b/,
    /apply online\b/,
    /start (?:your )?application\b/,
    /apply today\b/,
  ]

  if (openSignals.some((pattern) => pattern.test(text))) {
    return 'Open Now'
  }

  return null
}

/*
 * Keep the UI's availability and priority badges synchronised.
 *
 * Frontend mappings:
 * APPLY_IMMEDIATELY  = Apply Now
 * APPLY_WHEN_OPENING = Prepare to Apply
 * HIGH_PRIORITY_WATCH = Watch Closely
 *
 * When an application actually opens:
 *   Watch Closely      -> Apply Now
 *   Prepare to Apply   -> Apply Now
 *   Apply Now          -> stays Apply Now
 *
 * app_status is deliberately never changed: opening a job does not mean the
 * user has applied.
 */
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

    /*
     * Prefer the actual application URL. If it is unavailable, fall back to
     * careers/source URLs for reachability monitoring, but do not infer an
     * opening from those fallback pages.
     */
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

    /*
     * Only infer Open Now/Closed from the actual application link. A generic
     * company careers page is not sufficient to change application status.
     */
    const checkedApplicationPage = Boolean(
      applicationLink &&
      checkedUrl === applicationLink &&
      result?.ok
    )

    let detectedStatus = null

    if (checkedApplicationPage) {
      detectedStatus = detectApplicationStatus(result.text)

      if (detectedStatus) {
        const previousPriority = placement.overall_priority
        const stateUpdates = synchroniseState(placement, detectedStatus)
        Object.assign(updates, stateUpdates)

        if (detectedStatus === 'Open Now') {
          opened++
        } else if (detectedStatus === 'Closed') {
          closed++
        }

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
        console.log(
          `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
          'application page reachable but status inconclusive; leaving status unchanged'
        )
      }
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
    `${opened} open, ${closed} closed, ` +
    `${priorityUpdated} priority updates, ` +
    `${inconclusive} inconclusive, ${unreachable} unreachable.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
