import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
const supabase = createClient(supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, ''), supabaseKey, { auth:{persistSession:false,autoRefreshToken:false}, realtime:{enabled:false} })
const TODAY=new Date().toISOString().slice(0,10)
const ROLE_TERMS=['intern','internship','industrial placement','year in industry','placement','co-op','coop','student','undergraduate','aerospace','aeronautical','aerodynamics','propulsion','flight','avionics','controls','guidance','navigation','spacecraft','rocket','launch','satellite','systems engineering','mechanical engineering','electrical engineering','manufacturing engineering','test engineer','simulation','thermal','structures','composites','cfd','flight software','embedded']
const EXCLUDE_TERMS=['recruiter','accounting','finance','legal','sales','marketing','reception','barista','driver','security guard','executive assistant','webinar','insight event']
function text(v=''){return String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function firstMatch(s,re){const m=s.match(re);return m?m[1]?.trim()||m[0].trim():null}
function normaliseUrl(u){try{return new URL(u).toString()}catch{return u}}
function scoreJob(job){const s=`${job.title} ${job.department} ${job.team} ${job.description}`.toLowerCase();let score=0;for(const term of ROLE_TERMS)if(s.includes(term))score+=['intern','internship','placement','year in industry','co-op','student','undergraduate'].includes(term)?12:3;for(const term of EXCLUDE_TERMS)if(s.includes(term))score-=15;if(/aerosp|rocket|spacecraft|propulsion|flight|avionics|guidance|navigation|satellite|cfd|aerodynamic|controls/.test(s))score+=20;if(/2027|2028/.test(s))score+=8;return Math.max(0,Math.min(100,score))}
function priority(score){if(score>=75)return'APPLY_IMMEDIATELY';if(score>=55)return'APPLY_WHEN_OPENING';if(score>=40)return'HIGH_PRIORITY_WATCH';if(score>=25)return'GOOD_BACKUP';return'LOW_PRIORITY'}
function parseSalary(s){const m=text(s).match(/(?:[$£€]\s?\d[\d,.]*(?:\s*[–-]\s*[$£€]?\d[\d,.]*)?\s*(?:\/\s*(?:hour|hr|year|yr|month|week))?)/i);return m?m[0]:null}
function parseDeadline(s){const m=text(s).match(/(?:deadline|apply by|applications? close|closing date)[:\s]+([^.;]{3,80})/i);return m?m[1].trim():null}
function parseDegree(s){const m=text(s).match(/(?:bachelor(?:'s)?|b\.s\.?|beng|meng|master(?:'s)?|degree)[^.!?]{0,180}/i);return m?m[0].trim():null}
function parseEligibility(s){const t=text(s);return{citizenship_requirement:firstMatch(t,/((?:U\.?S\.? person|US person|U\.S\. citizenship|citizen(?:ship)?)[^.!?]{0,100})/i),right_to_work_requirement:firstMatch(t,/((?:right to work|work authorization|authori[sz]ation to work)[^.!?]{0,120})/i),security_clearance_requirement:firstMatch(t,/((?:security clearance|clearance)[^.!?]{0,100})/i)}}

function toPlacement(job){const description=job.description||'',fit=scoreJob(job),eligibility=parseEligibility(description),salary=job.salary||parseSalary(description),deadline=parseDeadline(description);return{company:job.company||'Company not identified',sector:job.sector||'Engineering',country:job.country||'UK/International',city:job.city||null,careers_page:job.careers_page||job.source_url,specific_role:job.title,department:job.department||null,engineering_area:job.team||null,placement_type:/intern|co-op|student|placement/i.test(job.title)?'Internship / Co-op':'Industrial Placement / Engineering role',application_status:'Open Now',exact_opening_date:job.opening_date||TODAY,exact_deadline:deadline||'Not stated',deadline_type:deadline?'Fixed/TBC':'Not stated',date_info_verified:job.opening_date?`Source published date: ${job.opening_date}`:`First observed automatically: ${TODAY}`,application_link:job.application_link,degree_requirements:job.degree_requirements||parseDegree(description),required_technical_skills:firstMatch(description,/((?:Python|MATLAB|Simulink|CFD|CAD|C\+\+|C\/C\+\+|FEA|flight dynamics|controls|avionics|composites)[^.!?]{0,180})/i),citizenship_requirement:eligibility.citizenship_requirement,right_to_work_requirement:eligibility.right_to_work_requirement,security_clearance_requirement:eligibility.security_clearance_requirement,salary,salary_period:salary&&/hour|hr/i.test(salary)?'Hourly':'Annual/As stated',aerospace_relevance:/aerosp|aircraft|flight|aero/i.test(description+job.title)?10:6,rocket_space_relevance:/rocket|spacecraft|launch|satellite|orbital|propulsion/i.test(description+job.title)?10:3,f1_motorsport_relevance:/formula 1|motorsport|racing/i.test(description+job.title)?10:1,aero_cfd_relevance:/cfd|aerodynamic|fluid|aero/i.test(description+job.title)?10:2,propulsion_relevance:/propulsion|engine|turbine|thrust/i.test(description+job.title)?10:2,controls_avionics_relevance:/controls|avionics|guidance|navigation|flight software|embedded/i.test(description+job.title)?10:2,prestige:8,career_value:Math.min(10,Math.max(1,Math.round(fit/10))),overall_priority:priority(fit),why_it_fits:`Automatically scored ${fit}/100 against aerospace, propulsion, CFD, controls, rockets and placement keywords.`,potential_weaknesses:'Automatic extraction only; verify eligibility and dates on the employer page before applying.',app_status:'Not Applied',cover_letter_required:'Unknown',source_url:job.source_url||job.application_link,source_type:job.source_type||'Web',source_date_checked:TODAY,source_verified:`Automatically discovered from ${job.source_type||'web'} on ${TODAY}`}}

async function gradcracker(){
  const u='https://www.gradcracker.com/search/aerospace/engineering-work-placements-internships?duration=Year-long'
  const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 placement-tracker/1.0'}});if(!r.ok)throw new Error(`Gradcracker HTTP ${r.status}`)
  const html=await r.text(), jobs=[], seen=new Set()
  const links=[...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)]
  for(const m of links){
    const title=text(m[2]),href=normaliseUrl(new URL(m[1],u).toString())
    if(!title||!href.includes('gradcracker.com')||seen.has(href)||scoreJob({title,description:title})<25)continue
    seen.add(href)
    let company=null, detail=''
    try{const d=await fetch(href,{headers:{'User-Agent':'Mozilla/5.0 placement-tracker/1.0'}});if(d.ok)detail=await d.text()}catch{}
    const dt=text(detail)
    company=firstMatch(dt,/(?:Company|Employer)\s*:?\s*([^|.]{2,100})/i)
    if(!company){const hub=href.match(/gradcracker\.com\/hub\/\d+\/([^/]+)/i);if(hub)company=hub[1].replace(/[-_]/g,' ')}
    if(!company){const hubName=firstMatch(dt,/([A-Z][A-Za-z0-9& .'-]{2,80})\s+Hub\s+(?:Home|About|Placements|Graduate)/i);if(hubName)company=hubName}
    if(!company){const titleCompany=firstMatch(title,/\b(?:at|with|for)\s+([A-Z][A-Za-z0-9& .'-]{2,60})$/i);company=titleCompany||null}
    if(!company||/see gradcracker listing/i.test(company)){
      const domain=href.match(/https?:\/\/([^/]+)/)?.[1]||'gradcracker.com';company=domain.replace(/^www\./,'').split('.')[0]
      if(company==='gradcracker')company='Company not identified'
    }
    const salary=firstMatch(dt,/(?:Salary|Bursary)\s*:?\s*([^|]{2,100})/i),location=firstMatch(dt,/Location\s*:?\s*([^|]{2,100})/i),degree=firstMatch(dt,/Degree required\s*:?\s*([^|]{2,100})/i),deadline=firstMatch(dt,/Deadline\s*:?\s*([^|]{2,100})/i),duration=firstMatch(dt,/Duration\s*:?\s*([^|]{2,100})/i)
    jobs.push({company:company.trim(),sector:'Engineering Careers',source_type:'Gradcracker',source_url:u,title,department:'',team:'',city:location||'',country:'UK/International',application_link:href,careers_page:u,description:dt||title,opening_date:null,salary,degree_requirements:degree,deadline:deadline?`Deadline: ${deadline}`:null,duration})
  }
  return jobs
}

async function webSearch(){
  const queries=['"year in industry" aerospace engineering placement UK 2027','"industrial placement" aerospace engineering UK 2027','"year-long placement" engineering aerospace UK student 2027','"aerospace" "placement year" engineering student UK']
  const jobs=[],seen=new Set()
  for(const q of queries){
    const url=`https://www.google.com/search?q=${encodeURIComponent(q)}&num=20`
    try{
      const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 placement-tracker/1.0'}});if(!r.ok)continue
      const html=await r.text()
      const matches=[...html.matchAll(/<a href="\/url\?q=([^&"]+)[^>]*>([\s\S]*?)<\/a>/gi)]
      for(const m of matches){
        let href=decodeURIComponent(m[1]);if(!/^https?:\/\//i.test(href)||href.includes('google.com'))continue
        const title=text(m[2]);if(!title||seen.has(href)||scoreJob({title,description:title})<25)continue
        seen.add(href)
        let company='Company not identified';try{company=new URL(href).hostname.replace(/^www\./,'').split('.')[0]}catch{}
        company=company==='gradcracker'?'Company not identified':company
        jobs.push({company,sector:'Engineering Careers',source_type:'Web Search',source_url:href,title,department:'',team:'',city:'',country:'UK/International',application_link:href,careers_page:href,description:title,opening_date:null})
      }
    }catch(e){console.error(`WEB SEARCH FAILED: ${q}: ${e.message}`)}
  }
  return jobs
}

async function upsertJobs(jobs){let relevant=0,inserted=0,updated=0;for(const job of jobs){if(scoreJob(job)<25)continue;relevant++;const placement=toPlacement(job);if(!placement.application_link)continue;const{data:existing,error:findError}=await supabase.from('placements').select('id,app_status').eq('application_link',placement.application_link).limit(1).maybeSingle();if(findError)throw findError;if(existing){const{error}=await supabase.from('placements').update({...placement,app_status:existing.app_status??'Not Applied'}).eq('id',existing.id);if(error)throw error;updated++}else{const{error}=await supabase.from('placements').insert(placement);if(error)throw error;inserted++;console.log(`NEW: ${placement.company} — ${placement.specific_role} — ${placement.application_link}`)}}return{relevant,inserted,updated}}

async function main(){
  let all=[]
  try{const g=await gradcracker();console.log(`Gradcracker: fetched ${g.length}`);all.push(...g)}catch(e){console.error(`SOURCE FAILED: Gradcracker: ${e.message}`)}
  try{const w=await webSearch();console.log(`Web search: found ${w.length} candidate pages`);all.push(...w)}catch(e){console.error(`SOURCE FAILED: Web search: ${e.message}`)}
  const result=await upsertJobs(all);console.log(`DISCOVERY COMPLETE: ${all.length} fetched, ${result.relevant} relevant, ${result.inserted} new, ${result.updated} refreshed.`)
}
main().catch(e=>{console.error(e);process.exit(1)})
