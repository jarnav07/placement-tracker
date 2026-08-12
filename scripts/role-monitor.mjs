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

  // If the secret was entered as https://<project>.supabase.co/rest/v1,
  // remove the REST path because supabase-js adds /rest/v1 itself.
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
const timeoutMs = 15000

function normaliseUrl(value) {
  if (!value) return null

  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

async function checkUrl(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response

    try {
      response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'placement-tracker-role-monitor/1.0',
        },
      })
    } catch {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'placement-tracker-role-monitor/1.0',
        },
      })
    }

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      error: error?.message ?? 'Unknown error',
    }
  } finally {
    clearTimeout(timer)
  }
}

/*
 * Keep application availability and priority consistent.
 *
 * IMPORTANT:
 * - application_status describes whether the COMPANY is accepting applications.
 * - app_status describes YOUR personal application progress.
 *
 * Therefore this function NEVER changes app_status.
 *
 * Priority transitions:
 *
 * HIGH_PRIORITY_WATCH
 *        ↓ application opens
 * APPLY_IMMEDIATELY
 *
 * APPLY_WHEN_OPENING
 *        ↓ application opens
 * APPLY_IMMEDIATELY
 *
 * APPLY_IMMEDIATELY
 *        ↓ application remains open
 * APPLY_IMMEDIATELY
 *
 * Other priorities are left unchanged.
 */
function synchroniseOpenRoleState(placement, applicationIsOpen) {
  if (!applicationIsOpen) {
    return {}
  }

  const priority = String(placement.overall_priority ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')

  const updates = {
    application_status: 'Open Now',
  }

  if (
    priority === 'HIGH_PRIORITY_WATCH' ||
    priority === 'APPLY_WHEN_OPENING'
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
  let broken = 0
  let opened = 0
  let priorityUpdated = 0

  for (const placement of placements ?? []) {
    /*
     * Only an actual application_link can make a role "Open Now".
     *
     * careers_page and source_url are checked for monitoring purposes,
     * but their being reachable does NOT mean the application is open.
     */
    const applicationLink = normaliseUrl(placement.application_link)

    const candidates = [
      placement.application_link,
      placement.careers_page,
      placement.source_url,
    ]
      .map(normaliseUrl)
      .filter(Boolean)

    if (!candidates.length) {
      continue
    }

    let result = null
    let checkedUrl = null

    for (const url of candidates) {
      result = await checkUrl(url)
      checkedUrl = url

      if (result.ok) {
        break
      }
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
     * A role is considered open by this monitor only when:
     *
     * 1. It has an actual application_link
     * 2. That application_link is the URL we successfully checked
     * 3. The URL is reachable
     *
     * A careers page being reachable is NOT enough.
     */
    const applicationIsOpen = Boolean(
      applicationLink &&
      result?.ok &&
      normaliseUrl(checkedUrl) === applicationLink
    )

    if (applicationIsOpen) {
      const previousPriority = placement.overall_priority

      const stateUpdates = synchroniseOpenRoleState(
        placement,
        applicationIsOpen
      )

      Object.assign(updates, stateUpdates)

      opened++

      if (
        stateUpdates.overall_priority === 'APPLY_IMMEDIATELY' &&
        previousPriority !== 'APPLY_IMMEDIATELY'
      ) {
        priorityUpdated++
      }

      console.log(
        `${placement.company} — ${placement.specific_role ?? 'role'}: ` +
        `APPLICATION OPEN → ${stateUpdates.overall_priority ?? previousPriority}`
      )
    }

    if (!result?.ok) {
      broken++

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
    } else {
      console.log(
        `${placement.company} — ` +
        `${placement.specific_role ?? 'role'}: ` +
        `${statusText} (${checkedUrl})`
      )
    }
  }

  console.log(
    `Monitor complete: ${checked} checked, ` +
    `${broken} unreachable, ` +
    `${opened} applications open, ` +
    `${priorityUpdated} priority updates.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
