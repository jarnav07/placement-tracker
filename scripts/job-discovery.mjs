import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, ''), supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { enabled: false },
})

const TODAY = new Date().toISOString().slice(0, 10)
const SOURCES = [
  { company:'SpaceX', sector:'Rockets & Space', type:'greenhouse', slug:'spacex', country:'USA' },
  { company:'Anduril Industries', sector:'Aerospace & Defence', type:'greenhouse', slug:'andurilindustries', country:'USA/UK' },
  { company:'Relativity Space', sector:'Rockets & Space', type:'greenhouse', slug:'relativity', country:'USA' },
  { company:'K2 Space', sector:'Rockets & Space', type:'greenhouse', slug:'k2spacecorporation', country:'USA' },
  { company:'Planet', sector:'Rockets & Space', type:'greenhouse', slug:'planetlabs', country:'USA/Global' },
  { company:'IonQ', sector:'Aerospace & Defence', type:'greenhouse', slug:'ionq', country:'USA/Global' },
  { company:'Waymo', sector:'Aerospace & Defence', type:'greenhouse', slug:'waymo', country:'USA' },
  { company:'Figure AI', sector:'Aerospace & Defence', type:'greenhouse', slug:'figureai', country:'USA' },
  { company:'Hermeus', sector:'Rockets & Space', type:'lever', slug:'hermeus', country:'USA' },
  { company:'Shield AI', sector:'Aerospace & Defence', type:'lever', slug:'shieldai', country:'USA' },
]

const ROLE_TERMS = ['intern','internship','industrial placement','year in industry','placement','co-op','coop','student','undergraduate','aerospace','aeronautical','aerodynamics','propulsion','flight','avionics','controls','guidance','navigation','spacecraft','rocket','launch','satellite','systems engineering','mechanical engineering','electrical engineering','manufacturing engineering','test engineer','simulation','thermal','structures','composites','cfd','flight software','embedded']
const EXCLUDE_TERMS = ['recruiter','accounting','finance','legal','sales','marketing','reception','barista','driver','security guard','executive assistant']

function text(v='') { return String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() }
function firstMatch(s, re) { const m = s.match(re); return m ? m[1]?.trim() || m[0].trim() : null }
function normaliseUrl(u) { try { return new URL(u).toString() } catch { return u } }
function parseSalary(s) { const m=text(s).match(/(?:[$£€]\s?\d[\d,.]*(?:\s*[–-]\s*[$£€]?\d[\d,.]*)?\s*(?:\/\s*(?:hour|hr|year|yr|month|week))?)/i); return m ? m[0] : null }
function parseDeadline(s) { const m=text(s).match(/(?:deadline|apply by|applications? close|closing date)[:\s]+([^.;]{3,80})/i); return m ? m[1].trim() : null }
function parseDegree(s) { const m=text(s).match(/(?:bachelor(?:'s)?|b\.s\.?|beng|meng|master(?:'s)?|degree)[^.!?]{0,180}/i); return m ? m[0].trim() : null }
function parseEligibility(s) {
  const t=text(s)
  return {
    citizenship_requirement:firstMatch(t,/((?:U\.?S\.? person|US person|U\.S\. citizenship|citizen(?:ship)?)[^.!?]{0,100})/i),
    right_to_work_requirement:firstMatch(t,/((?:right to work|work authorization|authori[sz]ation to work)[^.!?]{0,120})/i),
    security_clearance_requirement:firstMatch(t,/((?:security clearance|clearance)[^.!?]{0,100})/i)
  }
}
function scoreJob(job) {
  const s=`${job.title} ${job.department} ${job.team} ${job.description}`.toLowerCase(); let score=0
  for(const term of ROLE_TERMS) if(s.includes(term)) score += ['intern','internship','placement','year in industry','co-op','student','undergraduate'].includes(term) ? 12 : 3
  for(const term of EXCLUDE_TERMS) if(s.includes(term)) score-=15
  if(/aerosp|rocket|spacecraft|propulsion|flight|avionics|guidance|navigation|satellite|cfd|aerodynamic|controls/.test(s)) score+=20
  if(/2027|2028/.test(s)) score+=8
  if(/paid|salary|compensation/.test(s)) score+=2
  return Math.max(0,Math.min(100,score))
}
function priority(score) { if(score>=75)return 'APPLY_IMMEDIATELY'; if(score>=55)return 'APPLY_WHEN_OPENING'; if(score>=40)return 'HIGH_PRIORITY_WATCH'; if(score>=25)return 'GOOD_BACKUP'; return 'LOW_PRIORITY' }

async function greenhouse(source) {
  const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${source.slug}/jobs?content=true`); if(!r.ok)throw new Error(`Greenhouse ${source.slug}: HTTP ${r.status}`)
  const data=await r.json()
  return (data.jobs??[]).map(j=>({company:source.company,sector:source.sector,source_type:'Greenhouse',source_url:`https://job-boards.greenhouse.io/${source.slug}`,title:text(j.title),department:text(j.departments?.map(x=>x.name).join(', ')),team:'',city:text(j.location?.name),country:source.country,application_link:normaliseUrl(j.absolute_url),careers_page:`https://job-boards.greenhouse.io/${source.slug}`,description:text(j.content),opening_date:j.first_published||j.created_at||null}))
}
async function lever(source) {
  const out=[]
  for(let skip=0;skip<1000;skip+=100){
    const r=await fetch(`https://api.lever.co/v0/postings/${source.slug}?mode=json&limit=100&skip=${skip}`); if(!r.ok)throw new Error(`Lever ${source.slug}: HTTP ${r.status}`)
    const data=await r.json(); out.push(...data.map(j=>({company:source.company,sector:source.sector,source_type:'Lever',source_url:`https://jobs.lever.co/${source.slug}`,title:text(j.text),department:text(j.categories?.department),team:text(j.categories?.team),city:text(j.categories?.location),country:source.country,application_link:normaliseUrl(j.hostedUrl||j.applyUrl),careers_page:`https://jobs.lever.co/${source.slug}`,description:text(j.descriptionPlain||j.description),opening_date:j.createdAt?new Date(j.createdAt).toISOString().slice(0,10):null,salary:j.salaryRange?`${j.salaryRange.currency||''} ${j.salaryRange.min||''}-${j.salaryRange.max||''} ${j.salaryRange.interval||''}`.trim():null})))
    if(data.length<100)break
  }
  return out
}

function toPlacement(job) {
  const description=job.description, fit=scoreJob(job), eligibility=parseEligibility(description), salary=job.salary||parseSalary(description), deadline=parseDeadline(description)
  return {
    company:job.company,sector:job.sector,country:job.country,city:job.city,careers_page:job.careers_page,specific_role:job.title,department:job.department,engineering_area:job.team||null,
    placement_type:/intern|co-op|student/i.test(job.title)?'Internship / Co-op':'Industrial Placement / Engineering role',application_status:'Open Now',exact_opening_date:job.opening_date||TODAY,exact_deadline:deadline||'Not stated',deadline_type:deadline?'Fixed/TBC':'Not stated',date_info_verified:job.opening_date?`ATS published date: ${job.opening_date}`:`First observed automatically: ${TODAY}`,
    application_link:job.application_link,degree_requirements:parseDegree(description),required_technical_skills:firstMatch(description,/((?:Python|MATLAB|Simulink|CFD|CAD|C\+\+|C\/C\+\+|FEA|flight dynamics|controls|avionics|composites)[^.!?]{0,180})/i),citizenship_requirement:eligibility.citizenship_requirement,right_to_work_requirement:eligibility.right_to_work_requirement,security_clearance_requirement:eligibility.security_clearance_requirement,salary,salary_period:salary&&/hour|hr/i.test(salary)?'Hourly':'Annual/As stated',
    aerospace_relevance:/aerosp|aircraft|flight|aero/i.test(description+job.title)?10:6,rocket_space_relevance:/rocket|spacecraft|launch|satellite|orbital|propulsion/i.test(description+job.title)?10:3,f1_motorsport_relevance:/formula 1|motorsport|racing/i.test(description+job.title)?10:1,aero_cfd_relevance:/cfd|aerodynamic|fluid|aero/i.test(description+job.title)?10:2,propulsion_relevance:/propulsion|engine|turbine|thrust/i.test(description+job.title)?10:2,controls_avionics_relevance:/controls|avionics|guidance|navigation|flight software|embedded/i.test(description+job.title)?10:2,prestige:8,career_value:Math.min(10,Math.max(1,Math.round(fit/10))),overall_priority:priority(fit),why_it_fits:`Automatically scored ${fit}/100 against aerospace, propulsion, CFD, controls, rockets and placement keywords.`,potential_weaknesses:'Automatic extraction only; verify eligibility and dates on the employer page before applying.',app_status:'Not Applied',cover_letter_required:'Unknown',source_url:job.application_link,source_type:job.source_type,source_date_checked:TODAY,source_verified:`Automatically discovered from public ${job.source_type} job-board API on ${TODAY}`
  }
}

async function main(){
  let fetched=0,relevant=0,inserted=0,updated=0
  for(const source of SOURCES){
    try{
      const jobs=source.type==='greenhouse'?await greenhouse(source):await lever(source); fetched+=jobs.length
      for(const job of jobs){
        if(scoreJob(job)<25)continue; relevant++; const placement=toPlacement(job)
        const {data:existing,error:findError}=await supabase.from('placements').select('id,app_status').eq('application_link',placement.application_link).limit(1).maybeSingle(); if(findError)throw findError
        if(existing){const {error}=await supabase.from('placements').update({...placement,app_status:existing.app_status??'Not Applied'}).eq('id',existing.id);if(error)throw error;updated++}
        else{const {error}=await supabase.from('placements').insert(placement);if(error)throw error;inserted++;console.log(`NEW: ${placement.company} — ${placement.specific_role} — ${placement.application_link}`)}
      }
      console.log(`${source.company}: fetched ${jobs.length}`)
    }catch(e){console.error(`SOURCE FAILED: ${source.company}: ${e.message}`)}
  }
  console.log(`DISCOVERY COMPLETE: ${fetched} fetched, ${relevant} relevant, ${inserted} new, ${updated} refreshed.`)
}
main().catch(e=>{console.error(e);process.exit(1)})
