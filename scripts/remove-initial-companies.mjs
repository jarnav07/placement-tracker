import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { enabled: false } })
const companies = ['SpaceX','Anduril Industries','Relativity Space','K2 Space','Planet','IonQ','Waymo','Figure AI','Hermeus','Shield AI']

async function main() {
  let total = 0
  for (const company of companies) {
    const { data, error } = await supabase.from('placements').select('id').eq('company', company)
    if (error) throw error
    if (!data?.length) { console.log(`${company}: 0 rows`); continue }
    const { error: deleteError } = await supabase.from('placements').delete().eq('company', company)
    if (deleteError) throw deleteError
    total += data.length
    console.log(`${company}: deleted ${data.length}`)
  }
  console.log(`CLEANUP COMPLETE: deleted ${total} rows from the 10 original company sources.`)
}
main().catch(error => { console.error(error); process.exit(1) })
