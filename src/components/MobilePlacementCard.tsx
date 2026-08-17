import { useRef, useState } from 'react'
import type { Placement, OverallPriority, AppStatus } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { PRIORITY_LABELS, PRIORITY_COLORS, scoreBarColor } from '../lib/utils'
import './MobilePlacementCard.css'

interface Props {
  placement: Placement
  onOpen: () => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

const SWIPE_THRESHOLD = 80
const MAX_SWIPE = 120

export default function MobilePlacementCard({ placement: p, onOpen, onSwipeLeft, onSwipeRight }: Props) {
  const priority = (p.overall_priority ?? 'LOW_PRIORITY') as OverallPriority
  const priorityLabel = PRIORITY_LABELS[priority]
  const appStage = p.app_status && p.app_status !== 'Not Applied' ? p.app_status : null
  const status = p.application_status ?? 'TBC'
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const didSwipe = useRef(false)
  const hapticTriggered = useRef(false)
  const [swipeX, setSwipeX] = useState(0)
  const [swipeBusy, setSwipeBusy] = useState(false)

  const triggerClick = () => {
    // Simulate a native tactile click with a very short, quiet Web Audio transient.
    // This runs from a touch gesture, so mobile browsers are allowed to start the audio context.
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(115, now)
      oscillator.frequency.exponentialRampToValueAtTime(70, now + 0.025)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.03)
      window.setTimeout(() => void context.close(), 100)
    } catch {
      // Haptic/audio feedback is optional; never let it interfere with the swipe.
    }
  }

  const updateSwipe = async (changes: Partial<Placement>) => {
    setSwipeBusy(true)
    const { error } = await supabase.from('placements').update(changes).eq('id', p.id)
    setSwipeBusy(false)
    if (error) console.error(`Could not save ${p.company} swipe action:`, error)
  }

  const handleSwipeLeft = () => {
    if (onSwipeLeft) onSwipeLeft()
    else void updateSwipe({ not_interested: !p.not_interested })
  }

  const handleSwipeRight = () => {
    if (onSwipeRight) {
      onSwipeRight()
      return
    }

    const currentlyApplied = (p.app_status ?? 'Not Applied') !== 'Not Applied'
    void updateSwipe({
      app_status: (currentlyApplied ? 'Not Applied' : 'Applied') as AppStatus,
      date_applied: currentlyApplied ? null : (p.date_applied ?? new Date().toISOString().slice(0, 10)),
    })
  }

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (swipeBusy) return
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    didSwipe.current = false
    hapticTriggered.current = false
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (!touchStart.current || swipeBusy) return
    const touch = e.touches[0]
    const dx = touch.clientX - touchStart.current.x
    const dy = touch.clientY - touchStart.current.y

    // Let normal vertical scrolling continue; only track a clearly horizontal gesture.
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
    e.stopPropagation()
    didSwipe.current = true

    // Give one simulated tactile click when the action threshold is first reached.
    if (Math.abs(dx) >= SWIPE_THRESHOLD && !hapticTriggered.current) {
      hapticTriggered.current = true
      triggerClick()
    }

    setSwipeX(Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, dx)))
  }

  const handleTouchEnd = () => {
    if (!touchStart.current) return
    const dx = swipeX
    touchStart.current = null
    setSwipeX(0)
    hapticTriggered.current = false

    if (Math.abs(dx) < SWIPE_THRESHOLD) {
      didSwipe.current = false
      return
    }

    if (dx < 0) handleSwipeLeft()
    else handleSwipeRight()

    window.setTimeout(() => { didSwipe.current = false }, 0)
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (didSwipe.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onOpen()
  }

  const swipeLabel = swipeX <= -35 ? (p.not_interested ? 'Back to opportunities' : 'Not interested') : swipeX >= 35 ? (appStage ? 'Unapply' : 'Apply') : null

  return (
    <button
      className="mobile-placement-card"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ transform: `translateX(${swipeX}px)` }}
      aria-label={`Open ${p.company} placement details`}
    >
      {swipeLabel && <span className={`mpc-swipe-label ${swipeX < 0 ? 'left' : 'right'}`}>{swipeLabel}</span>}
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
