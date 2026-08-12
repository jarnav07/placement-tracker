import type { Placement, OverallPriority } from './supabase'

export const PRIORITY_LABELS: Record<OverallPriority, string> = {
  APPLY_IMMEDIATELY: 'Apply Now',
  APPLY_WHEN_OPENING: 'Top Priority',
  HIGH_PRIORITY_WATCH: 'High Priority',
  GOOD_BACKUP: 'Good Backup',
  LOW_PRIORITY: 'Low Priority',
}

export const PRIORITY_COLORS: Record<OverallPriority, string> = {
  APPLY_IMMEDIATELY: '#ef4444',
  APPLY_WHEN_OPENING: '#f97316',
  HIGH_PRIORITY_WATCH: '#eab308',
  GOOD_BACKUP: '#22c55e',
  LOW_PRIORITY: '#9ca3af',
}

export const PRIORITY_ORDER: Record<OverallPriority, number> = {
  APPLY_IMMEDIATELY: 0,
  APPLY_WHEN_OPENING: 1,
  HIGH_PRIORITY_WATCH: 2,
  GOOD_BACKUP: 3,
  LOW_PRIORITY: 4,
}

export type NormalizedStatus = 'Open Now' | 'Opening Soon' | 'Expected' | 'Not Yet Published' | 'Closed'

export const STATUS_ORDER: Record<NormalizedStatus, number> = {
  'Open Now': 0,
  'Opening Soon': 1,
  Expected: 2,
  'Not Yet Published': 3,
  Closed: 4,
}

/**
 * Database values have historically used both "Open" and "Open Now".
 * Keep all status decisions in one place so cards, counts and filters agree.
 */
export function normalizeApplicationStatus(value: string | null | undefined): NormalizedStatus {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'open' || v === 'open now' || v === 'currently open' || v.includes('open now')) return 'Open Now'
  if (v === 'opening soon' || v.includes('opening soon') || v.includes('opens soon')) return 'Opening Soon'
  if (v === 'expected' || v.includes('expected')) return 'Expected'
  if (v === 'not yet published' || v.includes('not yet') || v.includes('not published') || v.includes('not currently published')) return 'Not Yet Published'
  if (v === 'closed' || v.includes('closed') || v.includes('applications closed')) return 'Closed'
  return 'Not Yet Published'
}

export function isOpenNow(placement: Placement): boolean {
  return normalizeApplicationStatus(placement.application_status) === 'Open Now'
}

export function getPriority(placement: Placement): OverallPriority {
  const value = placement.overall_priority as OverallPriority | null
  return value && value in PRIORITY_ORDER ? value : 'LOW_PRIORITY'
}

export function getSectors(placements: Placement[]): string[] {
  return Array.from(new Set(placements.map((p) => p.sector?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

export function getCountries(placements: Placement[]): string[] {
  return Array.from(new Set(placements.map((p) => p.country?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

export function getEngineeringAreas(placements: Placement[]): string[] {
  return Array.from(new Set(placements.map((p) => p.engineering_area?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

export function sortPlacements(placements: Placement[], mode: string = 'priority'): Placement[] {
  return [...placements].sort((a, b) => {
    if (mode === 'deadline') {
      const da = dateScore(a.exact_deadline)
      const db = dateScore(b.exact_deadline)
      if (da !== db) return da - db
    }
    if (mode === 'cv_fit') {
      const diff = (b.cv_fit ?? -1) - (a.cv_fit ?? -1)
      if (diff !== 0) return diff
    }
    if (mode === 'aerospace') {
      const diff = (b.aerospace_relevance ?? -1) - (a.aerospace_relevance ?? -1)
      if (diff !== 0) return diff
    }
    if (mode === 'space') {
      const diff = (b.rocket_space_relevance ?? -1) - (a.rocket_space_relevance ?? -1)
      if (diff !== 0) return diff
    }
    if (mode === 'f1') {
      const diff = (b.f1_motorsport_relevance ?? -1) - (a.f1_motorsport_relevance ?? -1)
      if (diff !== 0) return diff
    }
    if (mode === 'recent') {
      const diff = new Date(b.source_date_checked ?? b.updated_at).getTime() - new Date(a.source_date_checked ?? a.updated_at).getTime()
      if (diff !== 0) return diff
    }

    const pa = PRIORITY_ORDER[getPriority(a)]
    const pb = PRIORITY_ORDER[getPriority(b)]
    if (pa !== pb) return pa - pb
    const cv = (b.cv_fit ?? -1) - (a.cv_fit ?? -1)
    if (cv !== 0) return cv
    const sa = STATUS_ORDER[normalizeApplicationStatus(a.application_status)]
    const sb = STATUS_ORDER[normalizeApplicationStatus(b.application_status)]
    if (sa !== sb) return sa - sb
    return a.company.localeCompare(b.company)
  })
}

function dateScore(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER
  const match = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

export function scoreBarColor(score: number): string {
  if (score >= 9) return '#22c55e'
  if (score >= 7) return '#84cc16'
  if (score >= 5) return '#eab308'
  if (score >= 3) return '#f97316'
  return '#ef4444'
}

export function isTBC(value: string | null): boolean {
  if (!value) return true
  const v = value.toLowerCase().trim()
  return v === 'tbc' || v === 'n/a' || v.includes('not publicly') || v === ''
}
