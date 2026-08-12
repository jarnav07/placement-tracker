import type { Placement, OverallPriority } from './supabase'

export type SortOption =
  | 'priority'
  | 'deadline'
  | 'cv_fit'
  | 'aerospace'
  | 'rocket_space'
  | 'f1'
  | 'aero_cfd'
  | 'propulsion'
  | 'controls'
  | 'recently_verified'
  | 'company'

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
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return null
}

export function filterPlacements(placements: Placement[], filters: {
  priority: string
  sector: string
  country: string
  engineeringArea: string
  status: string
  stage: string
  search: string
  applicationsOnly: boolean
}): Placement[] {
  const q = filters.search.trim().toLowerCase()
  return placements.filter(p => {
    if (filters.priority !== 'all' && p.overall_priority !== filters.priority) return false
    if (filters.sector !== 'all' && p.sector !== filters.sector) return false
    if (filters.country !== 'all' && p.country !== filters.country) return false
    if (filters.engineeringArea !== 'all' && p.engineering_area !== filters.engineeringArea) return false
    if (filters.status !== 'all' && normaliseApplicationStatus(p.application_status) !== filters.status) return false
    const stage = p.app_status ?? 'Not Applied'
    if (filters.applicationsOnly && stage === 'Not Applied') return false
    if (filters.stage !== 'all' && stage !== filters.stage) return false
    if (q) {
      const haystack = [p.company,p.specific_role,p.sector,p.city,p.country,p.engineering_area,p.department,p.placement_type,p.placement_duration,p.degree_requirements,p.required_technical_skills,p.why_it_fits,p.notes,p.cv_version,p.referral_contact]
        .filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function sortFilteredPlacements(placements: Placement[], sort: SortOption): Placement[] {
  const priorityOrder: Record<string, number> = { APPLY_IMMEDIATELY: 0, APPLY_WHEN_OPENING: 1, HIGH_PRIORITY_WATCH: 2, GOOD_BACKUP: 3, LOW_PRIORITY: 4 }
  const score = (p: Placement, key: keyof Placement) => Number(p[key] ?? 0)
  return [...placements].sort((a,b) => {
    if (sort === 'company') return a.company.localeCompare(b.company)
    if (sort === 'deadline') {
      const ad = dateFromText(a.exact_deadline), bd = dateFromText(b.exact_deadline)
      if (ad === null && bd === null) return 0
      if (ad === null) return 1
      if (bd === null) return -1
      return ad - bd
    }
    if (sort === 'recently_verified') {
      const ad = dateFromText(a.source_date_checked), bd = dateFromText(b.source_date_checked)
      if (ad === null && bd === null) return 0
      if (ad === null) return 1
      if (bd === null) return -1
      return bd - ad
    }
    if (sort === 'priority') return (priorityOrder[a.overall_priority ?? ''] ?? 99) - (priorityOrder[b.overall_priority ?? ''] ?? 99)
    const keyMap: Record<string, keyof Placement> = {
      cv_fit: 'cv_fit', aerospace: 'aerospace_relevance', rocket_space: 'rocket_space_relevance', f1: 'f1_motorsport_relevance', aero_cfd: 'aero_cfd_relevance', propulsion: 'propulsion_relevance', controls: 'controls_avionics_relevance'
    }
    const diff = score(b, keyMap[sort]) - score(a, keyMap[sort])
    return diff || (priorityOrder[a.overall_priority ?? ''] ?? 99) - (priorityOrder[b.overall_priority ?? ''] ?? 99)
  })
}
