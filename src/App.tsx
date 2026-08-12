import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Placement, OverallPriority, AppStatus } from './lib/supabase'
import { sortPlacements, PRIORITY_LABELS, PRIORITY_COLORS, SECTORS } from './lib/utils'
import { downloadExcel } from './lib/excel'
import PlacementCard from './components/PlacementCard'
import './App.css'

type FilterPriority = 'all' | OverallPriority
type View = 'opportunities' | 'applications'
const APP_STAGES: AppStatus[] = ['Saved','Applied','Assessment','Interview','Final Interview','Offer','Accepted','Rejected','Withdrawn']

function normaliseStatus(status: string | null): string {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'open' || s === 'open now' || s.includes('currently open')) return 'Open Now'
  if (s === 'opening soon' || s.includes('opens soon')) return 'Opening Soon'
  if (s === 'expected') return 'Expected'
  if (s.includes('not yet published') || s.includes('not published')) return 'Not Yet Published'
  if (s === 'closed' || s.includes('closed')) return 'Closed'
  return status ?? 'Not Yet Published'
}

export default function App() {
  const [placements, setPlacements] = useState<Placement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<FilterPriority>('all')
  const [filterSector, setFilterSector] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterStage, setFilterStage] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('opportunities')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [connected, setConnected] = useState(false)
  const prevIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function load() {
      const { data, error } = await supabase.from('placements').select('*').order('created_at', { ascending: false })
      if (error) { setError(error.message); setLoading(false); return }
      const loaded = data as Placement[]
      setPlacements(loaded); prevIds.current = new Set(loaded.map(p => p.id)); setLoading(false)
    }
    load()
    channel = supabase.channel('placements-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'placements' }, payload => {
      if (payload.eventType === 'INSERT') {
        const row = payload.new as Placement
        setPlacements(prev => prev.some(p => p.id === row.id) ? prev : [row, ...prev])
        setNewIds(prev => new Set(prev).add(row.id)); setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(row.id); return n }), 5000)
      } else if (payload.eventType === 'UPDATE') {
        const row = payload.new as Placement
        setPlacements(prev => prev.map(p => p.id === row.id ? row : p))
      } else if (payload.eventType === 'DELETE') {
        const row = payload.old as Placement
        setPlacements(prev => prev.filter(p => p.id !== row.id))
      }
    }).subscribe(status => setConnected(status === 'SUBSCRIBED'))
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  async function updatePlacement(p: Placement) {
    const { id, ...rest } = p
    setPlacements(prev => prev.map(x => x.id === id ? p : x))
    const { error } = await supabase.from('placements').update(rest).eq('id', id)
    if (error) setError(`Could not save ${p.company}: ${error.message}`)
  }

  const counts = {
    total: placements.length,
    open: placements.filter(p => normaliseStatus(p.application_status) === 'Open Now').length,
    soon: placements.filter(p => normaliseStatus(p.application_status) === 'Opening Soon').length,
    expected: placements.filter(p => normaliseStatus(p.application_status) === 'Expected').length,
    applied: placements.filter(p => (p.app_status ?? 'Not Applied') !== 'Not Applied').length,
  }
  const priorityCounts: Record<string, number> = { all: placements.length }
  for (const key of Object.keys(PRIORITY_LABELS) as OverallPriority[]) priorityCounts[key] = placements.filter(p => p.overall_priority === key).length
  const sectors = Array.from(new Set(placements.map(p => p.sector).filter(Boolean) as string[])).sort()

  const filtered = sortPlacements(placements.filter(p => {
    if (filterPriority !== 'all' && p.overall_priority !== filterPriority) return false
    if (filterSector !== 'all' && p.sector !== filterSector) return false
    if (filterStatus !== 'all' && normaliseStatus(p.application_status) !== filterStatus) return false
    const stage = p.app_status ?? 'Not Applied'
    if (view === 'applications' && stage === 'Not Applied') return false
    if (filterStage !== 'all' && stage !== filterStage) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = `${p.company} ${p.specific_role} ${p.sector} ${p.city} ${p.country} ${p.engineering_area} ${p.department} ${p.notes} ${p.cv_version}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }))

  const priorityTabs: { key: FilterPriority; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#64748b' },
    { key: 'APPLY_IMMEDIATELY', label: 'Apply Now', color: PRIORITY_COLORS.APPLY_IMMEDIATELY },
    { key: 'APPLY_WHEN_OPENING', label: 'Opening Soon', color: PRIORITY_COLORS.APPLY_WHEN_OPENING },
    { key: 'HIGH_PRIORITY_WATCH', label: 'High Watch', color: PRIORITY_COLORS.HIGH_PRIORITY_WATCH },
    { key: 'GOOD_BACKUP', label: 'Good Backup', color: PRIORITY_COLORS.GOOD_BACKUP },
    { key: 'LOW_PRIORITY', label: 'Low Priority', color: PRIORITY_COLORS.LOW_PRIORITY },
  ]
  const stageCounts = Object.fromEntries(APP_STAGES.map(s => [s, placements.filter(p => (p.app_status ?? 'Not Applied') === s).length])) as Record<string, number>

  return <div className="app">
    <header className="app-header"><div className="header-content">
      <div className="header-top"><div className="brand"><div className="brand-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.16 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.16-1.62 0-5 0-5"/></svg></div><div><h1>2027-28 Placement Tracker</h1><p className="brand-sub">Aerospace · Space · Rockets · F1 · {counts.total} opportunities tracked</p></div></div>
      <div className="header-right"><div className={`connection-indicator ${connected ? 'connected' : 'connecting'}`}><span className="conn-dot" />{connected ? 'Live' : 'Connecting…'}</div><button className="download-btn" onClick={() => downloadExcel(placements)}>Download Excel</button></div></div>
      <div className="stats-row"><div className="stat-chip"><span className="stat-num">{counts.total}</span><span className="stat-label">Total</span></div><button className="stat-chip open" onClick={() => { setView('opportunities'); setFilterStatus('Open Now') }}><span className="stat-num">{counts.open}</span><span className="stat-label">Open Now</span></button><button className="stat-chip soon" onClick={() => { setView('opportunities'); setFilterStatus('Opening Soon') }}><span className="stat-num">{counts.soon}</span><span className="stat-label">Opening Soon</span></button><div className="stat-chip expected"><span className="stat-num">{counts.expected}</span><span className="stat-label">Expected</span></div><button className="stat-chip applied" onClick={() => setView('applications')}><span className="stat-num">{counts.applied}</span><span className="stat-label">My Applications</span></button></div>
    </div></header>

    <main className="app-main">
      <div className="view-switcher"><button className={view === 'opportunities' ? 'active' : ''} onClick={() => setView('opportunities')}>All Opportunities</button><button className={view === 'applications' ? 'active' : ''} onClick={() => setView('applications')}>My Applications <span>{counts.applied}</span></button></div>
      {view === 'opportunities' && <section className="summary-bar">{priorityTabs.map(tab => <button key={tab.key} className={`summary-tab ${filterPriority === tab.key ? 'active' : ''}`} onClick={() => setFilterPriority(tab.key)} style={filterPriority === tab.key ? { borderColor: tab.color } : {}}><span className="tab-dot" style={{ background: tab.color }}/><span className="tab-label">{tab.label}</span><span className="tab-count">{priorityCounts[tab.key] ?? 0}</span></button>)}</section>}
      {view === 'applications' && <section className="pipeline"><div className="pipeline-title"><h2>Application Pipeline</h2><span>{counts.applied} tracked</span></div><div className="pipeline-stages">{APP_STAGES.map(s => <button key={s} className={filterStage === s ? 'active' : ''} onClick={() => setFilterStage(filterStage === s ? 'all' : s)}><strong>{stageCounts[s]}</strong><span>{s}</span></button>)}</div></section>}
      <section className="controls"><div className="search-box"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder={view === 'applications' ? 'Search applications, notes, contacts…' : 'Search companies, roles, locations, areas…'} value={search} onChange={e => setSearch(e.target.value)}/></div><div className="filter-selects"><select value={filterSector} onChange={e => setFilterSector(e.target.value)}><option value="all">All Sectors</option>{sectors.map(s => <option key={s} value={s}>{s}</option>)}</select><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Application Statuses</option><option>Open Now</option><option>Opening Soon</option><option>Expected</option><option>Not Yet Published</option><option>Closed</option></select>{view === 'applications' && <select value={filterStage} onChange={e => setFilterStage(e.target.value)}><option value="all">All My Stages</option>{APP_STAGES.map(s => <option key={s}>{s}</option>)}</select>}<button className="clear-filters" onClick={() => { setFilterPriority('all'); setFilterSector('all'); setFilterStatus('all'); setFilterStage('all'); setSearch('') }}>Clear</button></div></section>
      {error && <div className="save-error">{error}</div>}
      {loading ? <div className="state-msg"><div className="spinner"/><p>Loading placements…</p></div> : filtered.length === 0 ? <div className="state-msg"><p>{view === 'applications' ? 'No applications match your filters yet.' : 'No placements match your filters.'}</p><button onClick={() => { setFilterStatus('all'); setFilterStage('all'); setSearch(''); setFilterSector('all'); setFilterPriority('all') }}>Clear filters</button></div> : <section className="placements-grid">{filtered.map(p => <PlacementCard key={p.id} placement={p} isNew={newIds.has(p.id)} onUpdate={updatePlacement}/>)}</section>}
    </main>
    <footer className="app-footer"><span>{filtered.length} {view === 'applications' ? 'application' : 'placement'}{filtered.length === 1 ? '' : 's'}</span><span className="footer-live"><span className="footer-dot"/> Auto-updates when new roles are added or status changes</span></footer>
  </div>
}
