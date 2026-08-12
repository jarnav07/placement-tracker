import type { Placement, OverallPriority } from './supabase'

export const PRIORITY_LABELS: Record<OverallPriority, string> = {
  APPLY_IMMEDIATELY: 'Apply Now',
  APPLY_WHEN_OPENING: 'Prepare to Apply',
  HIGH_PRIORITY_WATCH: 'Watch Closely',
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

export const SECTORS = ['Aerospace & Defence', 'Rockets & Space', 'F1 & Motorsport', 'Propulsion', 'Research'] as const

export const STATUS_ORDER: Record<string, number> = {
  'Open Now': 0,
  'Opening Soon': 1,
  'Expected': 2,
  'Not Yet Published': 3,
  'Closed': 4,
}

export function sortPlacements(placements: Placement[]): Placement[] {
  return [...placements].sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.overall_priority ?? 'LOW_PRIORITY') as OverallPriority] ?? 5
    const pb = PRIORITY_ORDER[(b.overall_priority ?? 'LOW_PRIORITY') as OverallPriority] ?? 5
    if (pa !== pb) return pa - pb
    const cv = (b.cv_fit ?? 0) - (a.cv_fit ?? 0)
    if (cv !== 0) return cv
    const sa = STATUS_ORDER[a.application_status ?? ''] ?? 5
    const sb = STATUS_ORDER[b.application_status ?? ''] ?? 5
    return sa - sb
  })
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
  const v = value.toLowerCase()
  return v === 'tbc' || v.includes('not publicly') || v.includes('not yet') || v === ''
}

export function getCountries(placements: Placement[]): string[] {
  const set = new Set(placements.map((p) => p.country).filter(Boolean) as string[])
  return Array.from(set).sort()
}