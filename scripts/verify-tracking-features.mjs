import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = [
  ['src/App.tsx', 'Application view', ['My Applications', "view==='applications'", 'Application Pipeline', 'filterCountry', 'COUNTRIES']],
  ['src/components/PlacementCard.tsx', 'Application tracking panel', ['Application Tracking', 'date_applied', 'cv_version', 'referral_contact', 'interview_date', 'cover_letter_required', 'notes']],
  ['src/lib/filtering.ts', 'Location classification', ['countryGroup', "'UK' | 'Europe' | 'Asia' | 'Oceania' | 'America'", 'Rocket Lab', 'New Zealand']],
  ['src/lib/supabase.ts', 'Application stage model', ['Saved', 'Assessment', 'Final Interview', 'Accepted', 'Withdrawn', 'date_applied', 'cv_version', 'referral_contact', 'interview_date', 'notes']],
  ['src/components/PlacementCard.css', 'Tracking controls styling', ['application-tracking', 'tracking-grid', 'tracking-notes']],
  ['src/App.css', 'Location/application UI styling', ['view-switcher', 'pipeline', 'filter-selects', 'stat-chip.applied']],
]

let failed = false
for (const [file, label, needles] of checks) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`MISSING: ${file} (${label})`)
    failed = true
    continue
  }
  const content = read(file)
  const missing = needles.filter((needle) => !content.includes(needle))
  if (missing.length) {
    console.error(`FAILED: ${label} in ${file}`)
    for (const needle of missing) console.error(`  missing: ${needle}`)
    failed = true
  } else {
    console.log(`PASS: ${label}`)
  }
}

if (failed) {
  console.error('\nProtected placement-tracker functionality is incomplete. Application tracking and location tracking must not be removed.')
  process.exit(1)
}
console.log('\nAll protected application-tracking and location-tracking features are present.')
