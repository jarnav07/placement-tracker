import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY GitHub Actions secrets.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
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
        headers: { 'User-Agent': 'placement-tracker-role-monitor/1.0' },
      })
    } catch {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'placement-tracker-role-monitor/1.0' },
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

async function main() {
  const { data: placements, error } = await supabase
    .from('placements')
    .select('id, company, specific_role, application_status, application_link, careers_page, source_url, source_verified')

  if (error) throw error

  console.log(`Checking ${placements?.length ?? 0} tracked opportunities...`)

  let checked = 0
  let broken = 0

  for (const placement of placements ?? []) {
    const candidates = [placement.application_link, placement.careers_page, placement.source_url]
      .map(normaliseUrl)
      .filter(Boolean)

    if (!candidates.length) continue

    let result = null
    let checkedUrl = null

    for (const url of candidates) {
      result = await checkUrl(url)
      checkedUrl = url
      if (result.ok) break
    }

    checked++

    const statusText = result?.ok
      ? `URL reachable (${result.status})`
      : `URL check failed${result?.status ? ` (${result.status})` : ''}`

    const sourceVerified = result?.ok
      ? `${statusText}; automatically checked ${today}`
      : `${statusText}; automatically checked ${today}`

    const updates = {
      source_date_checked: today,
      source_verified: sourceVerified,
      updated_at: new Date().toISOString(),
    }

    if (!result?.ok) {
      broken++
      updates.notes = `Automated monitor: tracked URL could not be reached on ${today}. ${result?.error ?? ''}`.trim()
    }

    const { error: updateError } = await supabase
      .from('placements')
      .update(updates)
      .eq('id', placement.id)

    if (updateError) {
      console.error(`Failed updating ${placement.company} — ${placement.specific_role}:`, updateError.message)
    } else {
      console.log(`${placement.company} — ${placement.specific_role ?? 'role'}: ${statusText} (${checkedUrl})`)
    }
  }

  console.log(`Monitor complete: ${checked} checked, ${broken} unreachable.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
