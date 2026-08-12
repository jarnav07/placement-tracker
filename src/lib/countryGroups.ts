export type CountryGroup = 'UK' | 'Europe' | 'Asia' | 'Oceania' | 'America'

const EUROPE = new Set(['albania','andorra','austria','belarus','belgium','bosnia and herzegovina','bulgaria','croatia','czech republic','czechia','denmark','estonia','finland','france','germany','greece','hungary','iceland','ireland','italy','kosovo','latvia','liechtenstein','lithuania','luxembourg','malta','moldova','monaco','montenegro','netherlands','north macedonia','norway','poland','portugal','romania','san marino','serbia','slovakia','slovenia','spain','sweden','switzerland','ukraine','vatican city'])
const ASIA = new Set(['afghanistan','armenia','azerbaijan','bahrain','bangladesh','bhutan','brunei','cambodia','china','cyprus','georgia','india','indonesia','iran','iraq','israel','japan','jordan','kazakhstan','kuwait','kyrgyzstan','laos','lebanon','malaysia','maldives','mongolia','myanmar','nepal','north korea','oman','pakistan','palestine','philippines','qatar','saudi arabia','singapore','south korea','south korea (republic of korea)','sri lanka','taiwan','tajikistan','thailand','timor-leste','turkey','turkmenistan','united arab emirates','uzbekistan','vietnam','yemen','hong kong','macau'])
const OCEANIA = new Set(['australia','new zealand','papua new guinea','fiji','samoa','tonga','vanuatu','solomon islands','micronesia','palau','marshall islands','kiribati','nauru','tuvalu'])
const AMERICA = new Set(['canada','united states','usa','united states of america','mexico','brazil','argentina','chile','colombia','peru','uruguay','paraguay','bolivia','ecuador','venezuela','guyana','suriname','french guiana','panama','costa rica','nicaragua','honduras','el salvador','guatemala','belize','cuba','jamaica','haiti','dominican republic','bahamas','barbados','trinidad and tobago','puerto rico'])

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ')
}

function hasToken(value: string, token: string): boolean {
  return new RegExp(`(^|[^a-z])${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}($|[^a-z])`, 'i').test(value)
}

export function countryGroup(country: string | null): CountryGroup {
  const raw = normalise(country ?? '')
  if (!raw) return 'Europe'

  // UK is checked first so "United Kingdom / Europe" and "London, UK"
  // can never be classified as Europe.
  if (['uk','united kingdom','great britain','britain','england','scotland','wales','northern ireland'].some(x => hasToken(raw, x))) return 'UK'
  if ([...OCEANIA].some(x => hasToken(raw, x))) return 'Oceania'
  if ([...AMERICA].some(x => hasToken(raw, x))) return 'America'
  if ([...ASIA].some(x => hasToken(raw, x))) return 'Asia'
  if ([...EUROPE].some(x => hasToken(raw, x))) return 'Europe'

  return 'Europe'
}
