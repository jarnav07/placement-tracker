// Audit every placement row and update its availability based on rigorous,
// evidence-gated verification. This script NEVER deletes rows and NEVER touches
// the user's application-tracking fields (app_status, dates, CV version, referral,
// interview, outcome, notes, not_interested).
//
// It only updates:
//   - application_status  (only when the verifier is confident)
//   - exact_opening_date / exact_deadline / deadline_type (only when verified)
//   - application_link    (only for a confirmed OPEN_NOW exact-role application page)
//   - source_date_checked / source_verified (verification trail)

import { createClient } from '@supabase/supabase-js'
import { verifyPlacement, TODAY } from './placement-verifier.mjs'

const rawSupabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')

if (!rawSupabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.')
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

const MAX_CONCURRENT = 2
const DELAY_MS = 350

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Optional safety backup. Requires the create_placements_backup RPC to be installed
// (see supabase/migrations). If it is not installed, this logs a warning and continues;
// the audit itself is still strictly non-destructive.
async function tryBackup() {
  try {
    const { data, error } = await supabase.rpc('create_placements_backup')
    if (error) {
      console.warn('BACKUP SKIPPED (create_placements_backup RPC not installed):', error.message)
      return
    }
    console.log('Backup created:', data)
  } catch (error) {
    console.warn('BACKUP SKIPPED:', error?.message ?? error)
  }
}

async function processRow(row) {
  if (row.not_interested === true) return 'SKIPPED_NOT_INTERESTED'

  const verification = await verifyPlacement({
    company: row.company,
    specific_role: row.specific_role,
    city: row.city,
    country: row.country,
    department: row.department,
    engineering_area: row.engineering_area,
    application_link: row.application_link,
    careers_page: row.careers_page,
    source_url: row.source_url,
    application_status: row.application_status
  })

  if (!verification.ok) {
    console.error(`${row.company} — ${row.specific_role ?? 'role'}: verification failed: ${verification.error}`)
    return 'ERROR'
  }

  const result = verification.result
  const mapped = result.mappedApplicationStatus

  // Verification trail is recorded even when we do not change the status.
  const update = {
    source_date_checked: TODAY,
    source_verified: result.evidence,
    updated_at: new Date().toISOString()
  }

  if (mapped) {
    update.application_status = mapped
  }
  if (result.opening_date) update.exact_opening_date = result.opening_date
  if (result.deadline) update.exact_deadline = result.deadline
  if (result.deadline_type) update.deadline_type = result.deadline_type

  // Only replace the tracked link when the verifier found the actual application
  // page for the exact, currently-open 2027 role.
  if (
    result.status === 'OPEN_NOW' &&
    result.direct_application_for_exact_role_found === true &&
    result.verified_application_url &&
    result.mappedApplicationStatus === 'Open Now'
  ) {
    update.application_link = result.verified_application_url
  }

  const { error } = await supabase.from('placements').update(update).eq('id', row.id)
  if (error) {
    console.error(`${row.company} — ${row.specific_role ?? 'role'}: DB update failed: ${error.message}`)
    return 'ERROR'
  }

  const statusNote = mapped ? ` -> ${mapped}` : ' (status unchanged)'
  console.log(`${row.company} — ${row.specific_role ?? 'role'}: ${result.status}${statusNote}`)
  return mapped || 'NO_CHANGE'
}

async function main() {
  await tryBackup()

  const { data: rows, error } = await supabase
    .from('placements')
    .select('*')
    .order('company', { ascending: true })

  if (error) throw error

  const before = (rows ?? []).length
  console.log(`Audit: ${before} rows loaded.`)

  let cursor = 0
  let changed = 0
  let unchanged = 0
  let skipped = 0
  let errors = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= (rows ?? []).length) return
      const outcome = await processRow(rows[index])
      if (outcome === 'SKIPPED_NOT_INTERESTED') skipped++
      else if (outcome === 'ERROR') errors++
      else if (outcome === 'NO_CHANGE') unchanged++
      else changed++
      await sleep(DELAY_MS)
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, (rows ?? []).length) }, worker))

  const { count: after, error: afterError } = await supabase
    .from('placements')
    .select('id', { count: 'exact', head: true })

  if (afterError) throw afterError

  console.log(`Audit complete: ${changed} statuses changed, ${unchanged} verified with no change, ${skipped} Not Interested skipped, ${errors} errors.`)
  console.log(`Row count before=${before}, after=${after}.`)
  if (after !== before) {
    console.error('WARNING: row count changed during audit. This script never deletes rows — investigate manually.')
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
