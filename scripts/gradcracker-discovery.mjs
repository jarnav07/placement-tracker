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

function clean(v='') {
  return String(v ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&#x27;/gi,"'")
    .replace(/&#x2F;/gi,'/')
    .replace(/\s+/g,' ')
    .trim()
}

function absolute(href) {
  try { return new URL(href,'https://www.gradcracker.com').toString() } catch { return href }
}

function validField(value, max=180) {
  const v = clean(value)
  if (!v || v.length > max) return null
  if (/^(see gradcracker listing|not stated|n\/a|unknown|details|apply now)$/i.test(v)) return null
  return v
}

function labelledField(html, label, nextLabels='Deadline|Salary|Location|Degree required|Duration|Company|Employer|Organisation|Organization') {
  const source = String(html ?? '')
  const re = new RegExp(
    `${label}\\s*:?\\s*(?:<[^>]+>\\s*)*([^|<]{2,180}?)(?=\\s+(?:${nextLabels})\\s*:|\\||<|$)`,
    'i'
  )
  const m = source.match(re)
  return m ? validField(m[1]) : null
}

function jsonLdObjects(html) {
  const objects = []
  const blocks = [...String(html ?? '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim())
      if (Array.isArray(parsed)) objects.push(...parsed)
      else if (parsed?.['@graph'] && Array.isArray(parsed['@graph'])) objects.push(...parsed['@graph'])
      else objects.push(parsed)
    } catch {
      // Some pages contain invalid JSON-LD; the HTML fallbacks below still work.
    }
  }
  return objects
}

function jsonLdJob(html) {
  return jsonLdObjects(html).find(o => {
    const type = Array.isArray(o?.['@type']) ? o['@type'] : [o?.['@type']]
    return type.some(t => String(t).toLowerCase() === 'jobposting')
  }) || null
}

function extractCompany(html, title='') {
  const job = jsonLdJob(html)
  const jsonCompany = job?.hiringOrganization?.name || job?.employer?.name
  const fromJson = validField(jsonCompany, 100)
  if (fromJson) return fromJson

  const labelled = [
    labelledField(html, 'Company'),
    labelledField(html, 'Employer'),
    labelledField(html, 'Organisation'),
    labelledField(html, 'Organization'),
  ].find(Boolean)
  if (labelled && labelled.length <= 100 && !/listing|placement|internship|engineering|apply/i.test(labelled)) return labelled

  // Gradcracker pages commonly expose the employer in a company-profile link.
  const profileLinks = [...String(html ?? '').matchAll(/<a[^>]+href=["'][^"']*(?:\/company|\/companies|\/hub\/company)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => validField(m[1], 100))
    .filter(Boolean)
    .filter(v => !/company|careers|jobs|view|more|apply/i.test(v))
  if (profileLinks[0]) return profileLinks[0]

  // Last-resort title parsing, but never accept a long sentence/paragraph.
  const titleMatch = String(title).match(/\b(?:at|with|for)\s+([A-Z][A-Za-z0-9&.'() -]{2,80})$/)
  return validField(titleMatch?.[1], 100)
}

function extractJobDetails(html, title='') {
  const job = jsonLdJob(html)
  const locationJson = job?.jobLocation?.address?.addressLocality || job?.jobLocation?.address?.addressRegion || job?.jobLocation?.name
  const degreeJson = job?.qualifications || job?.educationRequirements
  const salaryJson = job?.baseSalary?.value?.value || job?.baseSalary?.value || job?.salary
  const deadlineJson = job?.validThrough

  return {
    company: extractCompany(html, title),
    location: validField(locationJson, 180) || labelledField(html, 'Location'),
    degree: validField(typeof degreeJson === 'string' ? degreeJson : JSON.stringify(degreeJson ?? ''), 300) || labelledField(html, 'Degree required'),
    salary: validField(typeof salaryJson === 'string' ? salaryJson : JSON.stringify(salaryJson ?? ''), 180) || labelledField(html, 'Salary|Bursary'),
    deadline: validField(deadlineJson, 100) || labelledField(html, 'Deadline'),
    duration: validField(job?.estimatedDuration || job?.duration, 120) || labelledField(html, 'Duration'),
    description: validField(job?.description, 30000) || clean(html).slice(0, 30000),
    datePosted: validField(job?.datePosted, 100),
    applicationUrl: validField(job?.url, 500),
  }
}

async function fetchPage(page) {
  const r = await fetch(page,{headers:{'User-Agent':'Mozilla/5.0 placement-tracker Gradcracker discovery'}})
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
  for(const page of SEARCHES){
    try {
      const html=await fetchPage(page)
      const parsed=parse(html)
      all.push(...parsed)
      console.log(`Gradcracker ${page}: ${parsed.length} candidates`)
    } catch(e) {
      console.error(`GRADCRACKER SOURCE FAILED: ${e.message}`)
    }
  }

  let inserted=0, refreshed=0, rejected=0
  for(const j of all){
    let detailHtml=''
    try { detailHtml=await fetchPage(j.href) } catch(e) { console.error(`DETAIL FAILED: ${j.href}: ${e.message}`) }

    const details=detailHtml ? extractJobDetails(detailHtml,j.title) : extractJobDetails(j.context,j.title)
    const company=details.company

    // Never create a database record with the entire listing/description as the company.
    // A company must be a short, identifiable employer name.
    if(!company || company.length>100 || /see gradcracker listing|deadline|salary|location|degree required|applications?/i.test(company)){
      rejected++
      console.log(`REJECTED GRADCRACKER (company not reliably extracted): ${j.title} — ${j.href}`)
      continue
    }

    const placement={
      company,
      sector:'Aerospace / Engineering',
      country:'United Kingdom',
      city:details.location,
      careers_page:j.href,
      specific_role:j.title,
      placement_type:'Placement / Internship',
      application_status:'Open Now',
      exact_opening_date:details.datePosted || TODAY,
      exact_deadline:details.deadline || 'Not stated',
      deadline_type:details.deadline?'Listed':'Not stated',
      date_info_verified:`Gradcracker listing checked ${TODAY}`,
      application_link:details.applicationUrl || j.href,
      degree_requirements:details.degree,
      salary:details.salary,
      salary_period:'As stated',
      required_technical_skills:details.description?.slice(0,2000) || null,
      aerospace_relevance:10,
      rocket_space_relevance:/rocket|space|satellite/i.test(`${j.title} ${details.description}`)?10:3,
      aero_cfd_relevance:/cfd|aerodynamic/i.test(`${j.title} ${details.description}`)?10:3,
      propulsion_relevance:/propulsion|engine/i.test(`${j.title} ${details.description}`)?10:3,
      controls_avionics_relevance:/controls|avionics|guidance|navigation/i.test(`${j.title} ${details.description}`)?10:3,
      f1_motorsport_relevance:/formula 1|motorsport/i.test(`${j.title} ${details.description}`)?10:1,
      prestige:7,
      career_value:8,
      overall_priority:'HIGH_PRIORITY_WATCH',
      why_it_fits:'Found through Gradcracker aerospace/STEM placement search.',
      potential_weaknesses:'Gradcracker listing extraction is automated; verify employer page and eligibility before applying.',
      app_status:'Not Applied',
      cover_letter_required:'Unknown',
      source_url:j.href,
      source_type:'Gradcracker',
      source_date_checked:TODAY,
      source_verified:`Gradcracker listing automatically checked ${TODAY}`
    }

    const {data:existing,error:findError}=await supabase.from('placements').select('id,app_status').eq('application_link',placement.application_link).limit(1).maybeSingle()
    if(findError){console.error(`DB LOOKUP FAILED: ${findError.message}`);continue}
    if(existing){
      const {error}=await supabase.from('placements').update({...placement,app_status:existing.app_status??'Not Applied'}).eq('id',existing.id)
      if(error) console.error(`UPDATE FAILED: ${error.message}`)
      else {refreshed++;console.log(`REFRESHED GRADCRACKER: ${company} — ${j.title}`)}
    } else {
      const {error}=await supabase.from('placements').insert(placement)
      if(error) console.error(`INSERT FAILED: ${error.message}`)
      else {inserted++;console.log(`NEW GRADCRACKER: ${company} — ${j.title} — ${placement.application_link}`)}
    }
  }
  console.log(`GRADCRACKER COMPLETE: ${all.length} candidates, ${inserted} new, ${refreshed} refreshed, ${rejected} rejected.`)
}
main().catch(e=>{console.error(e);process.exit(1)})
