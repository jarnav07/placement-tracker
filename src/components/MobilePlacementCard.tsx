import type { Placement, OverallPriority } from '../lib/supabase'
import { PRIORITY_LABELS, PRIORITY_COLORS, scoreBarColor } from '../lib/utils'
import './MobilePlacementCard.css'

interface Props {
  placement: Placement
  onOpen: () => void
}

export default function MobilePlacementCard({ placement: p, onOpen }: Props) {
  const priority = (p.overall_priority ?? 'LOW_PRIORITY') as OverallPriority
  const priorityLabel = PRIORITY_LABELS[priority]
  const appStage = p.app_status && p.app_status !== 'Not Applied' ? p.app_status : null
  const status = p.application_status ?? 'TBC'

  return (
    <button className="mobile-placement-card" onClick={onOpen} aria-label={`Open ${p.company} placement details`}>
      <div className="mpc-topline">
        <span className="mpc-company">{p.company}</span>
        <span className="mpc-score" style={{ color: scoreBarColor(p.cv_fit ?? 0) }}>{p.cv_fit ?? '?'}</span>
      </div>
      <div className="mpc-role">{p.specific_role ?? 'Role TBC'}</div>

      <div className="mpc-badges">
        <span className="mpc-badge priority" style={{ '--badge-color': PRIORITY_COLORS[priority] } as React.CSSProperties}>{priorityLabel}</span>
        <span className="mpc-badge status">{status}</span>
        {appStage && <span className="mpc-badge stage">{appStage}</span>}
      </div>

      <div className="mpc-info">
        <span>{p.city ?? p.country ?? 'Location TBC'}</span>
        <span>{p.exact_deadline ?? 'Deadline TBC'}</span>
        <span>{p.salary ?? 'Salary TBC'}</span>
      </div>

      <div className="mpc-footer">
        <span className="mpc-sector">{p.sector ?? 'Engineering'}</span>
        <span className="mpc-details">Details <span aria-hidden="true">›</span></span>
      </div>
    </button>
  )
}
