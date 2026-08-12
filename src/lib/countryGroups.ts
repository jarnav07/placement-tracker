export type CountryGroup = 'UK' | 'Europe' | 'Asia' | 'Oceania' | 'America'

const EUROPE = new Set(['Albania','Andorra','Austria','Belarus','Belgium','Bosnia and Herzegovina','Bulgaria','Croatia','Czech Republic','Czechia','Denmark','Estonia','Finland','France','Germany','Greece','Hungary','Iceland','Ireland','Italy','Kosovo','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Moldova','Monaco','Montenegro','Netherlands','North Macedonia','Norway','Poland','Portugal','Romania','San Marino','Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland','Ukraine','Vatican City'])
const ASIA = new Set(['Afghanistan','Armenia','Azerbaijan','Bahrain','Bangladesh','Bhutan','Brunei','Cambodia','China','Cyprus','Georgia','India','Indonesia','Iran','Iraq','Israel','Japan','Jordan','Kazakhstan','Kuwait','Kyrgyzstan','Laos','Lebanon','Malaysia','Maldives','Mongolia','Myanmar','Nepal','North Korea','Oman','Pakistan','Palestine','Philippines','Qatar','Saudi Arabia','Singapore','South Korea','South Korea (Republic of Korea)','Sri Lanka','Taiwan','Tajikistan','Thailand','Timor-Leste','Turkey','Turkmenistan','United Arab Emirates','Uzbekistan','Vietnam','Yemen','Hong Kong','Macau'])
const OCEANIA = new Set(['Australia','New Zealand','Papua New Guinea','Fiji','Samoa','Tonga','Vanuatu','Solomon Islands','Micronesia','Palau','Marshall Islands','Kiribati','Nauru','Tuvalu'])
const AMERICA = new Set(['Canada','United States','USA','United States of America','Mexico','Brazil','Argentina','Chile','Colombia','Peru','Uruguay','Paraguay','Bolivia','Ecuador','Venezuela','Guyana','Suriname','French Guiana','Panama','Costa Rica','Nicaragua','Honduras','El Salvador','Guatemala','Belize','Cuba','Jamaica','Haiti','Dominican Republic','Bahamas','Barbados','Trinidad and Tobago','Puerto Rico'])

export function countryGroup(country: string | null): CountryGroup {
  const c = (country ?? '').trim()
  if (/^(UK|United Kingdom|England|Scotland|Wales|Northern Ireland|Great Britain|Britain)$/i.test(c)) return 'UK'
  if (EUROPE.has(c)) return 'Europe'
  if (ASIA.has(c)) return 'Asia'
  if (OCEANIA.has(c)) return 'Oceania'
  if (AMERICA.has(c)) return 'America'
  return 'Europe'
}
