export type CountryGroup = 'UK' | 'Europe' | 'Asia' | 'Oceania' | 'America'
const EUROPE = new Set(['albania','andorra','austria','belarus','belgium','bosnia and herzegovina','bulgaria','croatia','czech republic','czechia','denmark','estonia','finland','france','germany','greece','hungary','iceland','ireland','italy','kosovo','latvia','liechtenstein','lithuania','luxembourg','malta','moldova','monaco','montenegro','netherlands','north macedonia','norway','poland','portugal','romania','san marino','serbia','slovakia','slovenia','spain','sweden','switzerland','ukraine','vatican city'])
const ASIA = new Set(['afghanistan','armenia','azerbaijan','bahrain','bangladesh','bhutan','brunei','cambodia','china','georgia','india','indonesia','iran','iraq','israel','japan','jordan','kazakhstan','kuwait','kyrgyzstan','laos','lebanon','malaysia','maldives','mongolia','myanmar','nepal','north korea','oman','pakistan','palestine','philippines','qatar','saudi arabia','singapore','south korea','sri lanka','taiwan','tajikistan','thailand','timor-leste','turkey','turkmenistan','united arab emirates','uzbekistan','vietnam','yemen','hong kong','macau'])
const OCEANIA = new Set(['australia','new zealand','papua new guinea','fiji','samoa','tonga','vanuatu','solomon islands','micronesia','palau','marshall islands','kiribati','nauru','tuvalu'])
const AMERICA = new Set(['canada','united states','usa','united states of america','mexico','brazil','argentina','chile','colombia','peru','uruguay','paraguay','bolivia','ecuador','venezuela','guyana','suriname','french guiana','panama','costa rica','nicaragua','honduras','el salvador','guatemala','belize','cuba','jamaica','haiti','dominican republic','bahamas','barbados','trinidad and tobago','puerto rico'])
function normalise(value: string): string { return value.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ') }
function containsCountry(value: string, names: Set<string>): boolean { return [...names].some(name => value === name || value.includes(name)) }
export function countryGroup(country: string | null, city = '', company = ''): CountryGroup {
  const raw = normalise(country ?? '')
  const location = normalise(`${raw} ${city} ${company}`)
  if (/rocket\s*lab/.test(location) && /(new zealand|\bnz\b|auckland|christchurch|mahia|whenuapai)/.test(location)) return 'Oceania'
  if (/rocket\s*lab/.test(location) && /(long beach|california|usa|united states)/.test(location)) return 'America'
  if (/\b(uk|united kingdom|great britain|britain|england|scotland|wales|northern ireland)\b/.test(location)) return 'UK'
  if (containsCountry(location, OCEANIA)) return 'Oceania'
  if (containsCountry(location, AMERICA)) return 'America'
  if (containsCountry(location, ASIA)) return 'Asia'
  if (containsCountry(location, EUROPE)) return 'Europe'
  return 'Europe'
}
