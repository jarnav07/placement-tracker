import type { Placement } from './supabase'

export type CountryGroup = 'UK' | 'Europe' | 'Asia' | 'Oceania'
export type SectorGroup = 'Aerospace & Space' | 'Defence' | 'Motorsport' | 'Engineering & Technology' | 'Research & Advanced Tech'
export type SortOption = 'deadline' | 'cv_fit' | 'relevance' | 'company'

const EUROPE_COUNTRIES = new Set(['Austria','Belgium','Bulgaria','Croatia','Cyprus','Czech Republic','Czechia','Denmark','Estonia','Finland','France','Germany','Greece','Hungary','Iceland','Ireland','Italy','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Monaco','Montenegro','Netherlands','North Macedonia','Norway','Poland','Portugal','Romania','San Marino','Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland','Ukraine','Vatican City'])
const ASIA_COUNTRIES = new Set(['Afghanistan','Armenia','Azerbaijan','Bahrain','Bangladesh','Bhutan','Brunei','Cambodia','China','Cyprus','Georgia','India','Indonesia','Iran','Iraq','Israel','Japan','Jordan','Kazakhstan','Kuwait','Kyrgyzstan','Laos','Lebanon','Malaysia','Maldives','Mongolia','Myanmar','Nepal','North Korea','Oman','Pakistan','Palestine','Philippines','Qatar','Saudi Arabia','Singapore','South Korea','Korea','Sri Lanka','Taiwan','Tajikistan','Thailand','Timor-Leste','Turkey','Turkmenistan','United Arab Emirates','Uzbekistan','Vietnam','Yemen','Hong Kong','Macau'])
const OCEANIA_COUNTRIES = new Set(['Australia','New Zealand','Papua New Guinea','Fiji','Samoa','Tonga','Vanuatu','Solomon Islands','Micronesia','Palau','Marshall Islands','Kiribati','Nauru','Tuvalu'])

export function countryGroup(country: string | null): CountryGroup {
  const c = (country ?? '').trim()
  if (/^(UK|United Kingdom|England|Scotland|Wales|Northern Ireland|Great Britain)$/i.test(c)) return 'UK'
  if (EUROPE_COUNTRIES.has(c)) return 'Europe'
  if (ASIA_COUNTRIES.has(c)) return 'Asia'
  if (OCEANIA_COUNTRIES.has(c)) return 'Oceania'
  // Every company must belong to one of the four UI groups. Unknown locations
  // are treated as Europe as the closest default for this placement tracker.
  return 'Europe'
}

export function sectorGroup(sector: string | null, company = ''): SectorGroup {
  const s = `${sector ?? ''} ${company}`.toLowerCase()
  if (/motorsport|formula|f1|racing|race car|automotive/.test(s)) return 'Motorsport'
  if (/defence|defense|military|security/.test(s)) return 'Defence'
  if (/research|university|laboratory|advanced research|r&d/.test(s)) return 'Research & Advanced Tech'
  if (/space|rocket|launch|aerospace|aviation|aircraft|satellite|propulsion/.test(s)) return 'Aerospace & Space'
  return 'Engineering & Technology'
}

export function normaliseApplicationStatus(status: string | null): string {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'open' || s === 'open now' || s.includes('currently open')) return 'Open Now'
  if (s === 'opening soon' || s.includes('opens soon')) return 'Opening Soon'
  if (s === 'expected') return 'Expected'
  if (s.includes('not yet published') || s.includes('not published')) return 'Not Yet Published'
  if (s === 'closed' || s.includes('closed')) return 'Closed'
  return status?.trim() || 'Not Yet Published'
}

export function dateFromText(value: string | null): number | null {
  if (!value) return null
  const direct = Date.parse(value)
  if (!Number.isNaN(direct)) return direct
  const match = value.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/)
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

export function filterPlacements(placements: Placement[], filters: { priority:string; sector:string; country:string; engineeringArea:string; status:string; stage:string; search:string; applicationsOnly:boolean }): Placement[] {
  const q = filters.search.trim().toLowerCase()
  return placements.filter(p => {
    if (filters.priority !== 'all' && p.overall_priority !== filters.priority) return false
    if (filters.sector !== 'all' && sectorGroup(p.sector, p.company) !== filters.sector) return false
    if (filters.country !== 'all' && countryGroup(p.country) !== filters.country) return false
    if (filters.engineeringArea !== 'all' && p.engineering_area !== filters.engineeringArea) return false
    if (filters.status !== 'all' && normaliseApplicationStatus(p.application_status) !== filters.status) return false
    const stage = p.app_status ?? 'Not Applied'
    if (filters.applicationsOnly && stage === 'Not Applied') return false
    if (filters.stage !== 'all' && stage !== filters.stage) return false
    if (q) {
      const haystack = [p.company,p.specific_role,p.sector,p.city,p.country,p.engineering_area,p.department,p.placement_type,p.placement_duration,p.degree_requirements,p.required_technical_skills,p.why_it_fits,p.notes,p.cv_version,p.referral_contact].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function sortFilteredPlacements(placements: Placement[], sort: SortOption): Placement[] {
  const priorityOrder: Record<string, number> = { APPLY_IMMEDIATELY:0, APPLY_WHEN_OPENING:1, HIGH_PRIORITY_WATCH:2, GOOD_BACKUP:3, LOW_PRIORITY:4 }
  return [...placements].sort((a,b) => {
    if (sort === 'company') return a.company.localeCompare(b.company)
    if (sort === 'deadline') { const ad=dateFromText(a.exact_deadline), bd=dateFromText(b.exact_deadline); if(ad===null&&bd===null)return 0; if(ad===null)return 1; if(bd===null)return -1; return ad-bd }
    if (sort === 'cv_fit') return Number(b.cv_fit ?? 0)-Number(a.cv_fit ?? 0) || (priorityOrder[a.overall_priority??'']??99)-(priorityOrder[b.overall_priority??'']??99)
    return (priorityOrder[a.overall_priority??'']??99)-(priorityOrder[b.overall_priority??'']??99) || Number(b.cv_fit ?? 0)-Number(a.cv_fit ?? 0)
  })
}
