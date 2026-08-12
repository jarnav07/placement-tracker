import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')

if (!rawSupabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
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

const checkedAt = new Date()
const today = checkedAt.toISOString().slice(0, 10)
const timeoutMs = 20000

function normaliseUrl(value) {
  if (!value) return null
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
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
        'User-Agent': 'Mozilla/5.0 (compatible; PlacementTrackerRoleMonitor/2.0)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      text: text.slice(0, 1000000),
    }
  } catch (error) {
    return { ok: false, status: null, finalUrl: url, text: '', error: error?.message ?? 'Unknown error' }
  } finally {
    clearTimeout(timer)
  }
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferStatus(company, pageText, currentStatus) {
  const text = pageText.toLowerCase()
  const name = company.toLowerCase()

  // Do not treat a reachable careers page as proof that applications are open.
  // Red Bull's page can contain the previous intake while explicitly saying to
  // watch for the next intake, so this check must take precedence.
  if (name.includes('red bull')) {
    if (/watch this space.{0,250}(2027 intake|2027)/i.test(pageText) || /2027 intake.{0,250}watch this space/i.test(pageText)) {
      return { status: 'Opening Soon', reason: 'Official page references the 2027 intake but says to watch for more information.' }
    }
    if (/applications? (are|is) (now )?open|apply now|applications? open/i.test(text)) {
      return { status: 'Open', reason: 'Official Red Bull page contains an explicit open-application signal.' }
    }
  }

  // Only update when there is strong evidence. Otherwise preserve the curated
  // database status rather than guessing from a generic careers page.
  if (/applications? (are|is) (now )?open|apply now|submit (an )?application|applications? open/i.test(text)) {
    return { status: 'Open', reason: 'Page contains an explicit application-open signal.' }
  }

  if (/applications? (are|is) closed|position (is )?closed|vacancy closed|no longer accepting applications/i.test(text)) {
    return { status: 'Closed', reason: 'Page contains an explicit closed-application signal.' }
  }

  return { status: currentStatus, reason: 'No sufficiently strong status signal; existing curated status preserved.' }
}

async function main() {
  const { data: placements, error } = await supabase
    .from('placements')
    .select('id, company, specific_role, application_status, application_link, careers_page, source_url, source_verified, notes')

  if (error) throw error

  console.log(`Checking ${placements?.length ?? 0} tracked placements...`)

  let checked = 0
  let changed = 0
  let unreachable = 0

  for (const placement of placements ?? []) {
    const candidates = [placement.application_link, placement.careers_page, placement.source_url]
      .map(normaliseUrl)
      .filter(Boolean)
      .filter((url, index, all) => all.indexOf(url) === index)

    if (!candidates.length) continue

    let result = null
    let checkedUrl = null

    for (const url of candidates) {
      result = await fetchPage(url)
      checkedUrl = url
      if (result.ok) break
    }

    checked++

    const updates = {
      source_date_checked: today,
      updated_at: checkedAt.toISOString(),
    }

    if (!result?.ok) {
      unreachable++
      updates.source_verified = `Automated monitor could not reach tracked source on ${today}; existing application status preserved.`
      updates.notes = `${placement.notes ? `${placement.notes} ` : ''}Automated monitor: source unreachable on ${today}.`.trim()
    } else {
      const pageText = cleanText(result.text)
      const inferred = inferStatus(placement.company, pageText, placement.application_status)
      updates.application_status = inferred.status
      updates.source_verified = `${inferred.reason} Source checked ${today}. URL status ${result.status}.`

      if (inferred.status !== placement.application_status) {
        changed++
        console.log(`STATUS CHANGE: ${placement.company} — ${placement.application_status} -> ${inferred.status}`)
      }

      console.log(`${placement.company} — ${placement.specific_role ?? 'role'}: ${inferred.status} (${checkedUrl})`)
    }

    const { error: updateError } = await supabase
      .from('placements')
      .update(updates)
      .eq('id', placement.id)

    if (updateError) console.error(`Failed updating ${placement.company}:`, updateError.message)
  }

  console.log(`Monitor complete: ${checked} checked, ${changed} status changes, ${unreachable} unreachable.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
