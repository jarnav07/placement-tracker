import { useState } from 'react'
import type { Placement, OverallPriority } from '../lib/supabase'
import { PRIORITY_LABELS, PRIORITY_COLORS, scoreBarColor, isTBC } from '../lib/utils'
import './PlacementCard.css'

interface Props {
  placement: Placement
  isNew?: boolean
  onUpdate?: (p: Placement) => void
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const val = score ?? 0
  const pct = (val / 10) * 100
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: scoreBarColor(val) }} />
      </div>
      <span className="score-value">{val}/10</span>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string | null }) {
  if (!value || isTBC(value)) return null
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}

export default function PlacementCard({ placement: p, isNew, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false)

  const priority = (p.overall_priority ?? 'LOW_PRIORITY') as OverallPriority
  const priorityColor = PRIORITY_COLORS[priority]
  const priorityLabel = PRIORITY_LABELS[priority]
  const statusClass = (p.application_status ?? '').replace(/\s+/g, '-').toLowerCase()

  const handleAppStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (onUpdate) onUpdate({ ...p, app_status: e.target.value })
  }

  return (
    <article
      className={`placement-card priority-${priority.replace(/_/g, '-').toLowerCase()} ${isNew ? 'is-new' : ''} ${expanded ? 'is-expanded' : ''}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="pc-header">
        <div className="pc-titles">
          <h3 className="pc-company">{p.company}</h3>
          <span className="pc-role">{p.specific_role ?? 'Role TBC'}</span>
        </div>
        <div className="pc-badges">
          <span className="priority-badge" style={{ background: priorityColor }}>{priorityLabel}</span>
          <span className={`status-badge status-${statusClass}`}>{p.application_status ?? 'TBC'}</span>
        </div>
      </div>

      <div className="pc-meta">
        <span className="meta-chip">{p.sector ?? '—'}</span>
        <span className="meta-chip">{p.city ?? 'TBC'}, {p.country ?? 'TBC'}</span>
        <span className="meta-chip">{p.placement_duration ?? 'TBC'}</span>
      </div>

      <div className="pc-scores">
        <div className="cv-fit-display">
          <span className="cv-fit-number" style={{ color: scoreBarColor(p.cv_fit ?? 0) }}>{p.cv_fit ?? '?'}</span>
          <span className="cv-fit-label">CV Fit /10</span>
        </div>
        <div className="mini-scores">
          <div className="mini-score"><span>Aero</span><b>{p.aerospace_relevance ?? '?'}</b></div>
          <div className="mini-score"><span>Space</span><b>{p.rocket_space_relevance ?? '?'}</b></div>
          <div className="mini-score"><span>F1</span><b>{p.f1_motorsport_relevance ?? '?'}</b></div>
          <div className="mini-score"><span>CFD</span><b>{p.aero_cfd_relevance ?? '?'}</b></div>
          <div className="mini-score"><span>Prop</span><b>{p.propulsion_relevance ?? '?'}</b></div>
          <div className="mini-score"><span>Ctrl</span><b>{p.controls_avionics_relevance ?? '?'}</b></div>
        </div>
      </div>

      <div className="pc-key-info">
        <div className="key-info-row">
          <span className="ki-label">Opens</span>
          <span className="ki-value">{p.exact_opening_date ?? 'TBC'}</span>
        </div>
        <div className="key-info-row">
          <span className="ki-label">Deadline</span>
          <span className="ki-value">{p.exact_deadline ?? 'TBC'}</span>
        </div>
        <div className="key-info-row">
          <span className="ki-label">Salary</span>
          <span className="ki-value">{p.salary ?? 'TBC'}</span>
        </div>
      </div>

      <div className={`pc-details ${expanded ? 'show' : ''}`}>
        <p className="pc-why"><strong>Why it fits:</strong> {p.why_it_fits ?? 'TBC'}</p>
        <p className="pc-weaknesses"><strong>Concerns:</strong> {p.potential_weaknesses ?? 'TBC'}</p>

        <div className="pc-scores-grid">
          <ScoreBar label="Aerospace" score={p.aerospace_relevance} />
          <ScoreBar label="Rocket/Space" score={p.rocket_space_relevance} />
          <ScoreBar label="F1/Motorsport" score={p.f1_motorsport_relevance} />
          <ScoreBar label="Aero/CFD" score={p.aero_cfd_relevance} />
          <ScoreBar label="Propulsion" score={p.propulsion_relevance} />
          <ScoreBar label="Controls/Avionics" score={p.controls_avionics_relevance} />
          <ScoreBar label="Prestige" score={p.prestige} />
          <ScoreBar label="Career Value" score={p.career_value} />
        </div>

        <div className="pc-detail-section">
          <h4>Eligibility</h4>
          <DetailItem label="Degree" value={p.degree_requirements} />
          <DetailItem label="Min Grade" value={p.min_grade_requirement} />
          <DetailItem label="Year of Study" value={p.year_of_study_requirement} />
          <DetailItem label="Skills" value={p.required_technical_skills} />
          <DetailItem label="Citizenship" value={p.citizenship_requirement} />
          <DetailItem label="Right to Work" value={p.right_to_work_requirement} />
          <DetailItem label="Security Clearance" value={p.security_clearance_requirement} />
          <DetailItem label="Visa" value={p.visa_requirement} />
        </div>

        <div className="pc-detail-section">
          <h4>Placement Details</h4>
          <DetailItem label="Type" value={p.placement_type} />
          <DetailItem label="Duration" value={p.placement_duration} />
          <DetailItem label="Start" value={p.placement_start_date} />
          <DetailItem label="End" value={p.placement_end_date} />
          <DetailItem label="Department" value={p.department} />
          <DetailItem label="Benefits" value={p.other_benefits} />
        </div>

        <div className="pc-detail-section">
          <h4>Application Tracking</h4>
          <div className="tracking-row">
            <label>Status</label>
            <select value={p.app_status ?? 'Not Applied'} onChange={handleAppStatusChange} onClick={(e) => e.stopPropagation()}>
              <option value="Not Applied">Not Applied</option>
              <option value="Applied">Applied</option>
              <option value="Interview">Interview</option>
              <option value="Offer">Offer</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          <DetailItem label="Source Verified" value={p.source_verified} />
          <DetailItem label="Source URL" value={p.source_url} />
        </div>

        <div className="pc-actions">
          {p.application_link && (
            <a href={p.application_link} target="_blank" rel="noopener noreferrer" className="pc-apply-btn" onClick={(e) => e.stopPropagation()}>
              {p.application_status === 'Open Now' ? 'Apply Now' : 'View Careers Page'}
            </a>
          )}
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer" className="pc-website-btn" onClick={(e) => e.stopPropagation()}>
              Company Website
            </a>
          )}
        </div>
      </div>

      <button className="pc-expand" onClick={(e) => { e.stopPropagation(); setExpanded((e2) => !e2) }}>
        {expanded ? 'Show less' : 'View details'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`chevron ${expanded ? 'up' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </article>
  )
}
