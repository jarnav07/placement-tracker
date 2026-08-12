import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Placement, OverallPriority } from './lib/supabase'
import { getCountries, getEngineeringAreas, getPriority, getSectors, isOpenNow, normalizeApplicationStatus, PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_ORDER, sortPlacements } from './lib/utils'
import { downloadExcel } from './lib/excel'
import PlacementCard from './components/PlacementCard'
import './App.css'

type FilterPriority = 'all' | OverallPriority
type FilterValue = 'all' | string
type SortMode = 'priority' | 'deadline' | 'cv_fit' | 'aerospace' | 'space' | 'f1' | 'recent'

const STATUS_OPTIONS = ['Open Now', 'Opening Soon', 'Expected', 'Not Yet Published', 'Closed'] as const

export default function App() {
  const [placements, setPlacements] = useState<Placement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<FilterPriority>('all')
  const [filterSector, setFilterSector] = useState<FilterValue>('all')
  const [filterCountry, setFilterCountry] = useState<FilterValue>('all')
  const [filterArea, setFilterArea] = useState<FilterValue>('all')
  const [filterStatus, setFilterStatus] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('priority')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [connected, setConnected] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const prevIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function load() {
      const { data, error } = await supabase.from('placements').select('*').order('created_at', { ascending: false })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      const loaded = data as Placement[]
      setPlacements(loaded)
      prevIds.current = new Set(loaded.map((p) => p.id))
      setLoading(false)
    }
    load()
    channel = supabase.channel('placements-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'placements' }, (payload) => {
      if (payload.eventType === 'INSERT') {
        const row = payload.new as Placement
        setPlacements((prev) => prev.some((p) => p.id === row.id) ? prev : [row, ...prev])
        markNew(row.id)
      } else if (payload.eventType === 'UPDATE') {
        const row = payload.new as Placement
        setPlacements((prev) => prev.map((p) => p.id === row.id ? row : p))
        markNew(row.id)
      } else if (payload.eventType === 'DELETE') {
        const row = payload.old as Placement
        setPlacements((prev) => prev.filter((p) => p.id !== row.id))
      }
    }).subscribe((status) => setConnected(status === 'SUBSCRIBED'))
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  function markNew(id: string) {
    setNewIds((prev) => new Set(prev).add(id))
    window.setTimeout(() => setNewIds((prev) => { const next = new Set(prev); next.delete(id); return next }), 5000)
  }

  async function updatePlacement(p: Placement) {
    const { id, ...rest } = p
    setPlacements((prev) => prev.map((x) => x.id === id ? p : x))
    const { error } = await supabase.from('placements').update(rest).eq('id', id)
    if (error) setError(`Could not save ${p.company}: ${error.message}`)
  }

  const counts = useMemo(() => ({
    total: placements.length,
    open: placements.filter(isOpenNow).length,
    soon: placements.filter((p) => normalizeApplicationStatus(p.application_status) === 'Opening Soon').length,
    expected: placements.filter((p) => normalizeApplicationStatus(p.application_status) === 'Expected').length,
    applied: placements.filter((p) => p.app_status && p.app_status !== 'Not Applied').length,
  }), [placements])

  const priorityCounts = useMemo(() => {
    const result: Record<string, number> = { all: placements.length }
    for (const key of Object.keys(PRIORITY_LABELS) as OverallPriority[]) result[key] = placements.filter((p) => getPriority(p) === key).length
    return result
  }, [placements])

  const sectors = useMemo(() => getSectors(placements), [placements])
  const countries = useMemo(() => getCountries(placements), [placements])
  const areas = useMemo(() => getEngineeringAreas(placements), [placements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = placements.filter((p) => {
      if (filterPriority !== 'all' && getPriority(p) !== filterPriority) return false
      if (filterSector !== 'all' && p.sector !== filterSector) return false
      if (filterCountry !== 'all' && p.country !== filterCountry) return false
      if (filterArea !== 'all' && p.engineering_area !== filterArea) return false
      if (filterStatus !== 'all' && normalizeApplicationStatus(p.application_status) !== filterStatus) return false
      if (q) {
        const hay = [p.company, p.specific_role, p.sector, p.city, p.country, p.engineering_area, p.department, p.placement_type].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return sortPlacements(result, sortMode)
  }, [placements, filterPriority, filterSector, filterCountry, filterArea, filterStatus, search, sortMode])

  const activeFilters = [filterPriority, filterSector, filterCountry, filterArea, filterStatus].filter((x) => x !== 'all').length + (search.trim() ? 1 : 0)
  const clearFilters = () => {
    setFilterPriority('all'); setFilterSector('all'); setFilterCountry('all'); setFilterArea('all'); setFilterStatus('all'); setSearch('')
  }

  const priorityTabs: { key: FilterPriority; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#64748b' },
    { key: 'APPLY_IMMEDIATELY', label: 'Apply Now', color: PRIORITY_COLORS.APPLY_IMMEDIATELY },
    { key: 'APPLY_WHEN_OPENING', label: 'Top Priority', color: PRIORITY_COLORS.APPLY_WHEN_OPENING },
    { key: 'HIGH_PRIORITY_WATCH', label: 'High Priority', color: PRIORITY_COLORS.HIGH_PRIORITY_WATCH },
    { key: 'GOOD_BACKUP', label: 'Good Backup', color: PRIORITY_COLORS.GOOD_BACKUP },
    { key: 'LOW_PRIORITY', label: 'Low Priority', color: PRIORITY_COLORS.LOW_PRIORITY },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div className="brand">
              <div className="brand-icon">🚀</div>
              <div><h1>2027–28 Placement Tracker</h1><p className="brand-sub">Aerospace · Space · Rockets · F1 · {counts.total} opportunities tracked</p></div>
            </div>
            <div className="header-right">
              <div className={`connection-indicator ${connected ? 'connected' : 'connecting'}`}><span className="conn-dot" />{connected ? 'Live' : 'Connecting…'}</div>
              <button className="download-btn" onClick={() => downloadExcel(placements)}>↓ Download Excel</button>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-chip"><span className="stat-num">{counts.total}</span><span className="stat-label">Total</span></div>
            <button className="stat-chip open" onClick={() => setFilterStatus('Open Now')}><span className="stat-num">{counts.open}</span><span className="stat-label">Open Now</span></button>
            <button className="stat-chip soon" onClick={() => setFilterStatus('Opening Soon')}><span className="stat-num">{counts.soon}</span><span className="stat-label">Opening Soon</span></button>
            <div className="stat-chip expected"><span className="stat-num">{counts.expected}</span><span className="stat-label">Expected</span></div>
            <div className="stat-chip applied"><span className="stat-num">{counts.applied}</span><span className="stat-label">Applications</span></div>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="summary-bar">
          {priorityTabs.map((tab) => <button key={tab.key} className={`summary-tab ${filterPriority === tab.key ? 'active' : ''}`} onClick={() => setFilterPriority(tab.key)} style={filterPriority === tab.key ? { borderColor: tab.color } : {}}><span className="tab-dot" style={{ background: tab.color }} /><span>{tab.label}</span><span className="tab-count">{priorityCounts[tab.key] ?? 0}</span></button>)}
        </section>

        <section className="controls">
          <div className="search-box"><span>⌕</span><input placeholder="Search companies, roles, locations, skills…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <button className={`filter-toggle ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters((v) => !v)}>Filters {activeFilters > 0 && <span>{activeFilters}</span>}</button>
          <select className="sort-select" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="priority">Sort: Personal priority</option><option value="deadline">Sort: Deadline</option><option value="cv_fit">Sort: CV fit</option><option value="aerospace">Sort: Aerospace relevance</option><option value="space">Sort: Rocket / Space</option><option value="f1">Sort: F1 / Motorsport</option><option value="recent">Sort: Recently verified</option>
          </select>
        </section>

        {showFilters && <section className="advanced-filters">
          <label>Application status<select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="all">All statuses</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Sector<select value={filterSector} onChange={(e) => setFilterSector(e.target.value)}><option value="all">All sectors</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Country<select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}><option value="all">All countries</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Engineering area<select value={filterArea} onChange={(e) => setFilterArea(e.target.value)}><option value="all">All engineering areas</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <button className="clear-filters" onClick={clearFilters}>Clear filters</button>
        </section>}

        {activeFilters > 0 && <div className="results-bar"><strong>{filtered.length}</strong> matching opportunities <button onClick={clearFilters}>Clear all</button></div>}

        {loading ? <div className="state-msg"><div className="spinner" /><p>Loading placements…</p></div> : error ? <div className="state-msg error"><p>Something went wrong.</p><p className="error-detail">{error}</p></div> : filtered.length === 0 ? <div className="state-msg"><p>No placements match your filters.</p><button className="clear-filters" onClick={clearFilters}>Clear filters</button></div> : <section className="placements-grid">{filtered.map((p) => <PlacementCard key={p.id} placement={p} isNew={newIds.has(p.id)} onUpdate={updatePlacement} />)}</section>}
      </main>
      <footer className="app-footer"><span>{filtered.length} of {placements.length} placements</span><span className="footer-live"><span className="footer-dot" /> Live database · status and new roles update automatically</span></footer>
    </div>
  )
}
