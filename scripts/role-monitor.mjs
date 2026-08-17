import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl=process.env.SUPABASE_URL?.trim().replace(/^['"]|['"]$/g,'')
const supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g,'')
if(!rawSupabaseUrl||!supabaseKey){console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY GitHub Actions secrets.');process.exit(1)}
const supabaseUrl=new URL(rawSupabaseUrl);supabaseUrl.pathname='';supabaseUrl.search='';supabaseUrl.hash=''
const supabase=createClient(supabaseUrl.toString().replace(/\/$/,''),supabaseKey,{auth:{persistSession:false,autoRefreshToken:false},realtime:{enabled:false}})
const today=new Date().toISOString().slice(0,10),timeoutMs=15000
function normaliseUrl(value){if(!value)return null;try{return new URL(value).toString()}catch{return null}}
async function checkUrl(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{let r;try{r=await fetch(url,{method:'HEAD',redirect:'follow',signal:controller.signal,headers:{'User-Agent':'placement-tracker-role-monitor/2.0'}})}catch{r=await fetch(url,{method:'GET',redirect:'follow',signal:controller.signal,headers:{'User-Agent':'placement-tracker-role-monitor/2.0'}})}return{ok:r.ok,status:r.status,finalUrl:r.url}}catch(error){return{ok:false,status:null,finalUrl:url,error:error?.message??'Unknown error'}}finally{clearTimeout(timer)}}
function protectedTrackingStatus(status){const s=String(status??'').trim().toLowerCase();return ['applied','application submitted','interview','interviewing','rejected','offer','offered','accepted','withdrawn','not interested'].some(v=>s===v||s.includes(v))}
async function main(){
  const{data:placements,error}=await supabase.from('placements').select('id,company,specific_role,application_status,app_status,application_link,careers_page,source_url');if(error)throw error
  const active=(placements??[]).filter(p=>String(p.app_status??'').trim().toLowerCase()!=='not interested');let checked=0,broken=0,skipped=0
  console.log(`Link monitor: checking ${active.length} roles. This step NEVER decides whether a placement is open.`)
  for(const p of active){
    const candidates=[p.application_link,p.careers_page,p.source_url].map(normaliseUrl).filter(Boolean);if(!candidates.length){skipped++;continue}
    let result=null,checkedUrl=null
    for(const url of [...new Set(candidates)]){result=await checkUrl(url);checkedUrl=url;if(result.ok)break}
    checked++
    const statusText=result?.ok?`URL reachable (${result.status})`:`URL check failed${result?.status?` (${result.status})`:''}`
    const updates={source_date_checked:today,source_verified:`Link monitor: ${statusText}; checked ${today}`,updated_at:new Date().toISOString()}
    if(!result?.ok){broken++;if(!protectedTrackingStatus(p.app_status)&&!protectedTrackingStatus(p.application_status))updates.notes=`Link monitor: tracked URL could not be reached on ${today}. ${result?.error??''}`.trim()}
    else console.log(`${p.company} — ${p.specific_role??'role'}: ${statusText} — ${checkedUrl}`)
    const{error:updateError}=await supabase.from('placements').update(updates).eq('id',p.id);if(updateError)console.error(`Failed updating ${p.company} — ${p.specific_role}: ${updateError.message}`)
  }
  console.log(`Link monitor complete: ${checked} checked, ${broken} unreachable, ${skipped} without usable URL. Availability is determined only by reliable student-placement verification.`)
}
main().catch(error=>{console.error(error);process.exit(1)})
