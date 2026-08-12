import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Placement, OverallPriority } from './lib/supabase'
import { sortPlacements, PRIORITY_LABELS, PRIORITY_COLORS, PRIORITY_ORDER, SECTORS } from './lib/utils'
import { downloadExcel } from './lib/excel'
import PlacementCard from './components/PlacementCard'
import './App.css'

type FilterPriority = 'all' | OverallPriority
type FilterSector = 'all' | string

export default function App() {
  const [placements, setPlacements] = useState<Placement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<FilterPriority>('all')
  const [filterSector, setFilterSector] = useState<FilterSector>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [connected, setConnected] = useState(false)
  const prevIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function load() {
      const { data, error } = await supabase.from('placements').select('*').order('created_at', { ascending: false })
      if (error) { setError(error.message); setLoading(false); return }
      const loaded = data as Placement[]
      setPlacements(loaded); prevIds.current = new Set(loaded.map((p) => p.id)); setLoading(false)
    }
    load()
    channel = supabase.channel('placements-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'placements' }, (payload) => {
      if (payload.eventType === 'INSERT') {
        const newRow = payload.new as Placement
        setPlacements((prev) => prev.some((p) => p.id === newRow.id) ? prev : [newRow, ...prev])
        setNewIds((prev) => new Set(prev).add(newRow.id))
        setTimeout(() => setNewIds((prev) => { const next = new Set(prev); next.delete(newRow.id); return next }), 5000)
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as Placement
        setPlacements((prev) => prev.map((p) => p.id === updated.id ? updated : p))
        const oldRow = payload.old as Placement | null
        if (oldRow && oldRow.application_status !== updated.application_status) {
          setNewIds((prev) => new Set(prev).add(updated.id))
          setTimeout(() => setNewIds((prev) => { const next = new Set(prev); next.delete(updated.id); return next }), 5000)
        }
      } else if (payload.eventType === 'DELETE') {
        const deleted = payload.old as Placement
        setPlacements((prev) => prev.filter((p) => p.id !== deleted.id))
      }
    }).subscribe((status) => setConnected(status === 'SUBSCRIBED'))
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  async function updatePlacement(p: Placement) {
    const { id, ...rest } = p
    setPlacements((prev) => prev.map((x) => x.id === p.id ? p : x))
    await supabase.from('placements').update(rest).eq('id', id)
  }

  const counts = {
    total: placements.length,
    open: placements.filter((p) => p.application_status === 'Open Now').length,
    soon: placements.filter((p) => p.application_status === 'Opening Soon').length,
    expected: placements.filter((p) => p.application_status === 'Expected').length,
  }

  const priorityCounts: Record<string, number> = { all: placements.length }
  for (const key of Object.keys(PRIORITY_LABELS) as OverallPriority[]) priorityCounts[key] = placements.filter((p) => p.overall_priority === key).length

  const filtered = sortPlacements(placements.filter((p) => {
    if (filterPriority !== 'all' && p.overall_priority !== filterPriority) return false
    if (filterSector !== 'all' && p.sector !== filterSector) return false
    if (filterStatus !== 'all' && p.application_status !== filterStatus) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = `${p.company} ${p.specific_role} ${p.sector} ${p.city} ${p.country} ${p.engineering_area} ${p.department}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }))

  const PRIORITY_TABS: { key: FilterPriority; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#64748b' },
    { key: 'APPLY_IMMEDIATELY', label: 'Apply Now', color: PRIORITY_COLORS.APPLY_IMMEDIATELY },
    { key: 'APPLY_WHEN_OPENING', label: 'Prepare to Apply', color: PRIORITY_COLORS.APPLY_WHEN_OPENING },
    { key: 'HIGH_PRIORITY_WATCH', label: 'Watch Closely', color: PRIORITY_COLORS.HIGH_PRIORITY_WATCH },
    { key: 'GOOD_BACKUP', label: 'Good Backup', color: PRIORITY_COLORS.GOOD_BACKUP },
    { key: 'LOW_PRIORITY', label: 'Low Priority', color: PRIORITY_COLORS.LOW_PRIORITY },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div className="brand">
              <div className="brand-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.16 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.16-1.62 0-5 0-5" /></svg></div>
              <div><h1>2027-28 Placement Tracker</h1><p className="brand-sub">Aerospace · Space · Rockets · F1 · {counts.total} opportunities tracked</p></div>
            </div>
            <div className="header-right"><div className={`connection-indicator ${connected ? 'connected' : 'connecting'}`}><span className="conn-dot" />{connected ? 'Live' : 'Connecting…'}</div><button className="download-btn" onClick={() => downloadExcel(placements)}>Download Excel</button></div>
          </div>
          <div className="stats-row">
            <div className="stat-chip"><span className="stat-num">{counts.total}</span><span className="stat-label">Total</span></div>
            <div className="stat-chip open"><span className="stat-num">{counts.open}</span><span className="stat-label">Open Now</span></div>
            <div className="stat-chip soon"><span className="stat-num">{counts.soon}</span><span className="stat-label">Opens Soon</span></div>
            <div className="stat-chip expected"><span className="stat-num">{counts.expected}</span><span className="stat-label">Expected</span></div>
          </div>
        </div>
      </header>
      <main className="app-main">
        <section className="summary-bar">
          {PRIORITY_TABS.map((tab) => <button key={tab.key} className={`summary-tab ${filterPriority === tab.key ? 'active' : ''}`} onClick={() => setFilterPriority(tab.key)} style={filterPriority === tab.key ? { borderColor: tab.color } : {}}><span className="tab-dot" style={{ background: tab.color }} /><span className="tab-label">{tab.label}</span><span className="tab-count">{priorityCounts[tab.key] ?? 0}</span></button>)}
        </section>
        <section className="controls">
          <div className="search-box"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg><input type="text" placeholder="Search companies, roles, locations, areas…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="filter-selects"><select value={filterSector} onChange={(e) => setFilterSector(e.target.value)}><option value="all">All Sectors</option>{SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}</select><select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="all">All Statuses</option><option value="Open Now">Open Now</option><option value="Opening Soon">Opening Soon</option><option value="Expected">Expected</option><option value="Not Yet Published">Not Yet Published</option><option value="Closed">Closed</option></select></div>
          <div className="results-summary"><strong>{filtered.length}</strong> opportunities shown</div>
        </section>
        {error && <div className="save-error">{error}</div>}
        {loading ? <div className="state-msg"><p>Loading placements…</p></div> : filtered.length === 0 ? <div className="state-msg"><p>No placements match your filters.</p></div> : <section className="placements-grid">{filtered.map((p) => <PlacementCard key={p.id} placement={p} isNew={newIds.has(p.id)} onUpdate={updatePlacement} />)}</section>}
      </main>
      <footer className="app-footer"><span>{filtered.length} placements</span><span className="footer-live"><span className="footer-dot" /> Auto-updates when new roles are added or status changes</span></footer>
    </div>
  )
}