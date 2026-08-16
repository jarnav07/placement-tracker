import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
const supabase = createClient(url, key, { auth:{persistSession:false,autoRefreshToken:false}, realtime:{enabled:false} })

const TODAY = new Date().toISOString().slice(0,10)
const SEARCHES = [
  'https://www.gradcracker.com/search/aerospace/work-placements-internships',
  'https://www.gradcracker.com/search/aerodynamics/work-placements-internships',
  'https://www.gradcracker.com/search/aeronautics/work-placements-internships',
  'https://www.gradcracker.com/search/avionics/work-placements-internships',
  'https://www.gradcracker.com/search/mechanical/work-placements-internships',
]
const TERMS = /intern|placement|undergraduate|year in industry|summer/i
const AERO = /aerospace|aeronaut|aerodynamic|avionic|propulsion|flight|space|rocket|satellite|cfd|formula 1|motorsport/i

function clean(v='') { return String(v).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim() }
function absolute(href) { try { return new URL(href,'https://www.gradcracker.com').toString() } catch { return href } }
function field(text,label) { const re=new RegExp(`${label}\\s*:?\\s*([^|]+?)(?=\\s+(?:Deadline|Salary|Location|Degree required|Duration)\\b|$)`,'i'); const m=text.match(re); return m?clean(m[1]):null }
function rolePart(v=''){return clean(v).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function sameRole(a,b){return rolePart(a.company)===rolePart(b.company)&&rolePart(a.specific_role)===rolePart(b.specific_role)&&(rolePart(a.city)===rolePart(b.city)||!a.city||!b.city)}

async function fetchPage(page) {
  const r=await fetch(page,{headers:{'User-Agent':'Mozilla/5.0 placement-tracker job discovery; contact via GitHub repository'}})
  if(!r.ok) throw new Error(`Gradcracker HTTP ${r.status}`)
  return await r.text()
}

function parse(html) {
  const jobs=[]
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while((m=re.exec(html))){
    const title=clean(m[2]), href=absolute(m[1])
    if(!title || title.length<8 || title.length>180 || !TERMS.test(title)) continue
    const context=clean(html.slice(Math.max(0,m.index-1500),Math.min(html.length,m.index+3500)))
    if(!AERO.test(`${title} ${context}`)) continue
    jobs.push({title,href,context})
  }
  const seen=new Set(); return jobs.filter(j=>!seen.has(j.href)&&seen.add(j.href))
}

async function main(){
  const all=[]
  for(const page of SEARCHES){ try { const html=await fetchPage(page); const parsed=parse(html); all.push(...parsed); console.log(`Gradcracker ${page}: ${parsed.length} candidates`) } catch(e){ console.error(`GRADCRACKER SOURCE FAILED: ${e.message}`) } }

  const {data:notInterested,error:notInterestedError}=await supabase.from('placements').select('id,company,specific_role,city,application_link').eq('app_status','Not Interested')
  if(notInterestedError) throw notInterestedError
  const ignored=notInterested||[]
  let inserted=0, refreshed=0, skipped=0

  for(const j of all){
    const t=j.context
    const placement={
      company:field(t,'Company') || 'See Gradcracker listing', sector:'Aerospace / Engineering', country:'United Kingdom', city:field(t,'Location'),
      careers_page:'https://www.gradcracker.com/', specific_role:j.title, placement_type:'Placement / Internship', application_status:'Open Now',
      exact_opening_date:TODAY, exact_deadline:field(t,'Deadline') || 'Not stated', deadline_type:field(t,'Deadline')?'Listed':'Not stated', date_info_verified:`Gradcracker listing checked ${TODAY}`,
      application_link:j.href, degree_requirements:field(t,'Degree required'), salary:field(t,'Salary'), salary_period:'As stated',
      aerospace_relevance:10, rocket_space_relevance:/rocket|space|satellite/i.test(t)?10:3, aero_cfd_relevance:/cfd|aerodynamic/i.test(t)?10:3, propulsion_relevance:/propulsion|engine/i.test(t)?10:3, controls_avionics_relevance:/controls|avionics|guidance|navigation/i.test(t)?10:3, f1_motorsport_relevance:/formula 1|motorsport/i.test(t)?10:1,
      prestige:7, career_value:8, overall_priority:'HIGH_PRIORITY_WATCH', why_it_fits:'Found through Gradcracker aerospace/STEM placement search.', potential_weaknesses:'Gradcracker listing extraction is automated; verify employer page and eligibility before applying.',
      app_status:'Not Applied', cover_letter_required:'Unknown', source_url:j.href, source_type:'Gradcracker', source_date_checked:TODAY, source_verified:`Gradcracker listing automatically checked ${TODAY}`
    }

    // A role the user has marked Not Interested is completely ignored by discovery.
    if(ignored.some(r=>r.application_link===placement.application_link || sameRole(r,placement))){
      skipped++
      console.log(`SKIPPED (Not Interested): ${placement.company} — ${placement.specific_role}`)
      continue
    }

    const {data:existing,error:findError}=await supabase.from('placements').select('id,app_status').eq('application_link',j.href).limit(1).maybeSingle()
    if(findError){console.error(`DB LOOKUP FAILED: ${findError.message}`);continue}
    if(existing){
      // Never refresh a role after it has been marked Not Interested.
      if(String(existing.app_status??'').trim().toLowerCase()==='not interested'){skipped++;console.log(`SKIPPED (Not Interested): ${placement.company} — ${placement.specific_role}`);continue}
      const {error}=await supabase.from('placements').update({...placement,app_status:existing.app_status??'Not Applied'}).eq('id',existing.id); if(error)console.error(`UPDATE FAILED: ${error.message}`); else refreshed++
    } else { const {error}=await supabase.from('placements').insert(placement); if(error)console.error(`INSERT FAILED: ${error.message}`); else {inserted++;console.log(`NEW GRADCRACKER: ${j.title} — ${j.href}`)} }
  }
  console.log(`GRADCRACKER COMPLETE: ${all.length} candidates, ${inserted} new, ${refreshed} refreshed, ${skipped} Not Interested skipped.`)
}
main().catch(e=>{console.error(e);process.exit(1)})
