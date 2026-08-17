import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '')
const openAiKey = process.env.OPENAI_API_KEY?.trim().replace(/^['"]|['"]$/g, '')
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna'

if (!rawSupabaseUrl || !supabaseKey) throw new Error('Missing Supabase secrets')
if (!openAiKey) throw new Error('Missing OPENAI_API_KEY GitHub Actions secret.')

const supabaseUrl = (() => { const u = new URL(rawSupabaseUrl); u.pathname=''; u.search=''; u.hash=''; return u.toString().replace(/\/$/,'') })()
const supabase = createClient(supabaseUrl, supabaseKey, { auth:{persistSession:false,autoRefreshToken:false}, realtime:{enabled:false} })
const TODAY = new Date().toISOString().slice(0,10)
const MAX_CONCURRENT = 2
const MAX_WEB_SEARCHES = 8
const AI_RECHECK_DAYS = 7
const MIN_CONFIDENCE = 0.88

const schema = {
  type:'object', additionalProperties:false,
  properties:{
    status:{type:'string',enum:['OPEN','CLOSED','UNKNOWN']}, confidence:{type:'number',minimum:0,maximum:1},
    exact_student_program_found:{type:'boolean'}, exact_role_found:{type:'boolean'}, current_intake_matches:{type:'boolean'},
    direct_application_for_exact_role_found:{type:'boolean'}, official_program_source_found:{type:'boolean'},
    evidence_summary:{type:'string'}, application_window:{type:'string'}, intake_year:{type:'string'}, opening_timing:{type:'string'},
    sources:{type:'array',items:{type:'object',additionalProperties:false,properties:{url:{type:'string'},type:{type:'string'},evidence:{type:'string'}},required:['url','type','evidence']}}
  },
  required:['status','confidence','exact_student_program_found','exact_role_found','current_intake_matches','direct_application_for_exact_role_found','official_program_source_found','evidence_summary','application_window','intake_year','opening_timing','sources']
}

const instructions = `You are the high-precision verification agent for an engineering student placement tracker.

Your job is NOT to decide whether a company has an Apply button. Your job is to decide whether the EXACT STUDENT INTERNSHIP / INDUSTRIAL PLACEMENT / YEAR-IN-INDUSTRY / WORK PLACEMENT PROGRAM AND THE EXACT ROLE are currently open for applications on the current date.

This tracker is deliberately conservative. A false positive is worse than leaving a role UNKNOWN. However, do not create false negatives by stopping at a generic careers page: investigate the employer's student-program pages and, where applicable, the employer job board until you can establish whether the exact role exists in the current intake.

DEFINITIONS
- Student program = internship, industrial placement, year in industry, year-long placement, work placement, co-op, undergraduate placement, student placement, or equivalent. Graduate jobs, permanent jobs, apprenticeships, insight events and generic jobs do not qualify.
- Exact role = the tracked role title/company/location or a clearly equivalent current vacancy within the identified student program. A generic Apply button, generic careers page, or job-board search page is NOT an exact role.
- Current intake = the intake/start year relevant to the present date. Do not treat a 2026-start vacancy as current during 2026 if its application window has already closed or the listing explicitly says applications/intake are closed. Prefer the next advertised intake when the site makes that clear.

OPEN RULE — ALL conditions must be satisfied:
1. The employer's student/placement program is identified.
2. The program is relevant to the tracked role.
3. The current intake is identified or there is strong evidence that the vacancy is part of the current recruiting cycle.
4. The EXACT role is currently present on the employer's live vacancy/job-board results OR the employer explicitly states that this exact role/program is currently accepting applications.
5. Evidence indicates applications can currently be submitted for THAT EXACT ROLE. A button that merely opens the company's general job board is not enough.
6. There is no stronger evidence saying the role/intake is closed, filled, expired, withdrawn, or from a previous cycle.
7. Confidence must be high. If any required element is uncertain, return UNKNOWN.

CLOSED RULE: Return CLOSED when reliable evidence says the exact role/intake is closed, filled, expired, withdrawn, applications have ended, the deadline passed, or the listing is clearly for a previous intake that is no longer accepting applications.

UNKNOWN RULE: Return UNKNOWN when the company/program is relevant but the exact current role cannot be verified, the employer job board cannot be searched reliably, evidence conflicts, or only generic application mechanisms are visible.

CRITICAL CONTEXT RULES
- 'Apply now', 'Apply', 'Submit application', 'View jobs', 'Search jobs', or similar generic buttons are NOT evidence that the tracked placement is open.
- If a button opens a job board, inspect the job board and find the EXACT tracked placement. If it is absent, do NOT call it OPEN.
- Search for the student/placement program separately from the role. A company may have a permanent-job board open while its student placement program is closed.
- Treat phrases such as 'applications typically open in October', 'applications open October-November', 'recruitment opens in autumn', 'applications open later this year', or similar seasonal guidance as evidence that the role is NOT open before that window.
- Treat 'applications for this role are closed', 'intake closed', 'vacancy closed', 'no longer accepting applications', 'deadline passed', 'position filled', '2026 intake', or similar language as strong evidence against OPEN when it applies to the tracked role/intake.
- Pay close attention to start dates. A 2026 start date can be a previous intake. Do not assume it is current merely because the page is still reachable.
- If the page contains a current 2027/2028 intake and an old 2026 listing, distinguish them.
- Do not infer a current opening from HTTP 200, page existence, search-engine indexing, or a stale cached result.
- Search the employer's official site first. Use reputable secondary sources only to locate evidence or corroborate it.
- Use multiple searches when necessary: exact role, company + student program, company + placement + intake year, and employer job-board searches.
- If a search result is stale, inspect the live employer page before relying on it.
- If evidence conflicts, choose UNKNOWN unless the conflict can be resolved by a more authoritative/current source.
- Do not invent dates, intake years, role availability, or application windows.
- Return only the structured result.`

function urlsFor(role){return [role.application_link,role.careers_page,role.source_url].filter(Boolean).map(v=>{try{return new URL(v).toString()}catch{return null}}).filter(Boolean)}
function buildPrompt(role){const links=urlsFor(role);return `Current date: ${TODAY}\n\nTRACKED PLACEMENT\nCompany: ${role.company??''}\nRole title: ${role.specific_role??''}\nLocation: ${role.city??''}\nDepartment/engineering area: ${role.engineering_area??role.department??''}\nKnown links:\n${links.length?links.map(u=>`- ${u}`).join('\n'):'- none'}\n\nVerification task:\n1. Identify the employer's relevant student placement/internship/year-in-industry/work-placement program.\n2. Determine the relevant current intake and whether its application window is open on ${TODAY}.\n3. Find the exact tracked role on the employer's live vacancy/job board if the program uses one.\n4. Distinguish the exact role from generic job-board access and unrelated jobs.\n5. Check for closing/deadline/previous-intake/seasonal-opening language.\n6. If the exact role is absent from the current job board, do not mark OPEN merely because the program or company has an Apply button.\n7. If the role is expected to open later, record that in opening_timing and return CLOSED unless there is a genuinely current open application window.\n\nThe output status must reflect the exact student placement, not general company recruitment.`}

async function askAgent(role){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000)
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${openAiKey}`},body:JSON.stringify({model,reasoning:{effort:'medium'},max_tool_calls:MAX_WEB_SEARCHES,max_output_tokens:1200,tools:[{type:'web_search'}],input:[{type:'message',role:'developer',content:[{type:'input_text',text:instructions}]},{type:'message',role:'user',content:[{type:'input_text',text:buildPrompt(role)}]}],text:{verbosity:'medium',format:{type:'json_schema',name:'reliable_student_placement_status',strict:true,schema}}})})
    const body=await response.json(); if(!response.ok)throw new Error(body?.error?.message||`OpenAI API returned HTTP ${response.status}`); if(!body?.output_text)throw new Error('OpenAI returned no output_text.')
    const result=JSON.parse(body.output_text); if(!['OPEN','CLOSED','UNKNOWN'].includes(result.status))throw new Error(`Invalid status: ${result.status}`); if(!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1)throw new Error('Invalid confidence.')
    const openAllowed=result.status==='OPEN'&&result.confidence>=MIN_CONFIDENCE&&result.exact_student_program_found&&result.exact_role_found&&result.current_intake_matches&&result.direct_application_for_exact_role_found&&result.official_program_source_found
    if(result.status==='OPEN'&&!openAllowed){result.status='UNKNOWN';result.evidence_summary=`Downgraded from OPEN by deterministic safety checks: exact current student-placement evidence was incomplete. ${result.evidence_summary}`}
    return result
  }finally{clearTimeout(timer)}
}

function protectedTrackingStatus(status){const s=String(status??'').trim().toLowerCase();return ['applied','application submitted','interview','interviewing','rejected','offer','offered','accepted','withdrawn','not interested'].some(v=>s===v||s.includes(v))}
function formatSources(sources=[]){return sources.filter(s=>s?.url).slice(0,5).map(s=>`${s.type}: ${s.url} — ${s.evidence}`).join('\n')}

async function processRole(role){
  if(String(role.app_status??'').trim().toLowerCase()==='not interested')return'SKIPPED'
  try{
    const result=await askAgent(role),sources=formatSources(result.sources)
    const summary=[`Placement verification ${TODAY}: ${result.status} (${Math.round(result.confidence*100)}% confidence).`,`Exact student program found: ${result.exact_student_program_found?'yes':'no'}. Exact role found: ${result.exact_role_found?'yes':'no'}. Current intake matches: ${result.current_intake_matches?'yes':'no'}.`,`Direct application for exact role: ${result.direct_application_for_exact_role_found?'yes':'no'}. Official program source: ${result.official_program_source_found?'yes':'no'}.`,`Intake: ${result.intake_year||'not established'}. Application window: ${result.application_window||'not established'}. Opening timing: ${result.opening_timing||'not established'}.`,result.evidence_summary,sources?`Evidence sources:\n${sources}`:''].filter(Boolean).join('\n')
    const updates={source_date_checked:TODAY,source_verified:`Reliable placement verification: ${result.status} (${Math.round(result.confidence*100)}% confidence); ${result.evidence_summary}`,updated_at:new Date().toISOString(),notes:summary}
    if(!protectedTrackingStatus(role.app_status)&&!protectedTrackingStatus(role.application_status)){if(result.status==='OPEN')updates.application_status='Open Now';else if(result.status==='CLOSED')updates.application_status='Closed';else updates.application_status='Unknown'}
    const{error}=await supabase.from('placements').update(updates).eq('id',role.id);if(error)throw error
    console.log(`${role.company} — ${role.specific_role}: ${result.status} (${Math.round(result.confidence*100)}%)`);return result.status
  }catch(error){console.error(`${role.company} — ${role.specific_role}: verification failed: ${error?.message??error}`);return'ERROR'}
}
function shouldResearch(role){const notes=String(role.notes??''),match=[...notes.matchAll(/Placement verification (\d{4}-\d{2}-\d{2})/g)].pop();if(!match)return true;const age=Math.floor((new Date(`${TODAY}T00:00:00Z`)-new Date(`${match[1]}T00:00:00Z`))/86400000);if(age>=AI_RECHECK_DAYS)return true;return String(role.application_status??'').trim().toLowerCase()==='unknown'&&age>=1}

async function main(){
  const{data:roles,error}=await supabase.from('placements').select('id, company, specific_role, city, department, engineering_area, application_status, app_status, application_link, careers_page, source_url, notes');if(error)throw error
  const selected=(roles??[]).filter(r=>String(r.app_status??'').trim().toLowerCase()!=='not interested'&&shouldResearch(r));console.log(`Reliable verification: ${selected.length}/${roles?.length??0} roles selected.`)
  let cursor=0,open=0,closed=0,unknown=0,errors=0
  async function worker(){while(true){const i=cursor++;if(i>=selected.length)return;const status=await processRole(selected[i]);if(status==='OPEN')open++;else if(status==='CLOSED')closed++;else if(status==='UNKNOWN')unknown++;else if(status==='ERROR')errors++}}
  await Promise.all(Array.from({length:Math.min(MAX_CONCURRENT,selected.length)},worker));console.log(`Reliable verification complete: ${open} OPEN, ${closed} CLOSED, ${unknown} UNKNOWN, ${errors} errors.`)
}
main().catch(error=>{console.error(error);process.exit(1)})
