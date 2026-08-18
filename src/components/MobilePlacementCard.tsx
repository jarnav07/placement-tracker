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
const SWIPE_SNAP_DURATION = 180
const DIRECTION_LOCK_DISTANCE = 8

export default function MobilePlacementCard({ placement: p, onOpen, onSwipeLeft, onSwipeRight }: Props) {
  const priority = (p.overall_priority ?? 'LOW_PRIORITY') as OverallPriority
  const priorityLabel = PRIORITY_LABELS[priority]
  const appStage = p.app_status && p.app_status !== 'Not Applied' ? p.app_status : null
  const status = p.application_status ?? 'TBC'
  const cardRef = useRef<HTMLButtonElement>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const activePointerId = useRef<number | null>(null)
  const gestureAxis = useRef<'horizontal' | 'vertical' | null>(null)
  const swipeX = useRef(0)
  const didSwipe = useRef(false)
  const hapticTriggered = useRef(false)
  const swipeBusy = useRef(false)
  const animationFrame = useRef<number | null>(null)
  const resetTimer = useRef<number | null>(null)
  const [swipeSide, setSwipeSide] = useState<'left' | 'right' | null>(null)

  const applySwipeVisual = (x: number, animate = false) => {
    const card = cardRef.current
    if (!card) return

    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current)
      animationFrame.current = null
    }

    const clamped = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, x))
    swipeX.current = clamped
    card.classList.toggle('is-dragging', !animate)

    animationFrame.current = requestAnimationFrame(() => {
      card.style.transform = `translate3d(${clamped}px, 0, 0)`
      animationFrame.current = null
    })
  }

  const resetSwipeVisual = () => {
    const card = cardRef.current
    if (!card) return
    card.classList.remove('is-dragging')
    card.style.transform = 'translate3d(0, 0, 0)'
    swipeX.current = 0
  }

  const triggerClick = () => {
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
      // Optional feedback must never interfere with the gesture.
    }
  }

  const updateSwipe = async (changes: Partial<Placement>) => {
    swipeBusy.current = true
    const { error } = await supabase.from('placements').update(changes).eq('id', p.id)
    swipeBusy.current = false
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

  const finishSwipe = () => {
    const dx = swipeX.current
    pointerStart.current = null
    activePointerId.current = null
    gestureAxis.current = null
    hapticTriggered.current = false
    setSwipeSide(null)

    if (Math.abs(dx) < SWIPE_THRESHOLD) {
      applySwipeVisual(0, true)
      resetTimer.current = window.setTimeout(resetSwipeVisual, SWIPE_SNAP_DURATION)
      didSwipe.current = false
      return
    }

    // Keep the card perfectly straight and give the release a short, natural settle.
    applySwipeVisual(dx > 0 ? 18 : -18, true)
    resetTimer.current = window.setTimeout(() => {
      resetSwipeVisual()
      if (dx < 0) handleSwipeLeft()
      else handleSwipeRight()
    }, SWIPE_SNAP_DURATION)

    window.setTimeout(() => { didSwipe.current = false }, SWIPE_SNAP_DURATION)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (swipeBusy.current || activePointerId.current !== null) return

    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current)
      resetTimer.current = null
    }

    activePointerId.current = e.pointerId
    pointerStart.current = { x: e.clientX, y: e.clientY }
    gestureAxis.current = null
    swipeX.current = 0
    didSwipe.current = false
    hapticTriggered.current = false
    setSwipeSide(null)

    // Pointer capture is important here: once the card moves under the finger,
    // the card still receives every subsequent pointer event.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is an enhancement; the gesture can still continue without it.
    }

    cardRef.current?.classList.add('is-dragging')
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current || activePointerId.current !== e.pointerId || swipeBusy.current) return

    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y

    // Only decide the gesture direction once. Once horizontal, keep following the
    // finger even when it reverses direction through the centre of the card.
    if (gestureAxis.current === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_LOCK_DISTANCE) return
      gestureAxis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }

    if (gestureAxis.current === 'vertical') return

    e.preventDefault()
    didSwipe.current = true

    if (Math.abs(dx) >= 35) {
      const nextSide = dx < 0 ? 'left' : 'right'
      setSwipeSide((current) => current === nextSide ? current : nextSide)
    } else {
      setSwipeSide(null)
    }

    if (Math.abs(dx) >= SWIPE_THRESHOLD && !hapticTriggered.current) {
      hapticTriggered.current = true
      triggerClick()
    }

    applySwipeVisual(dx)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerId.current !== e.pointerId || !pointerStart.current) return

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // Ignore browsers without pointer capture support.
    }

    finishSwipe()
  }

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerId.current !== e.pointerId || !pointerStart.current) return

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // Ignore browsers without pointer capture support.
    }

    pointerStart.current = null
    activePointerId.current = null
    gestureAxis.current = null
    hapticTriggered.current = false
    setSwipeSide(null)
    applySwipeVisual(0, true)
    resetTimer.current = window.setTimeout(resetSwipeVisual, SWIPE_SNAP_DURATION)
    didSwipe.current = false
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (didSwipe.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onOpen()
  }

  const swipeLabel = swipeSide === 'left'
    ? (p.not_interested ? 'Back to opportunities' : 'Not interested')
    : swipeSide === 'right'
      ? (appStage ? 'Unapply' : 'Apply')
      : null

  return (
    <button
      ref={cardRef}
      className="mobile-placement-card"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label={`Open ${p.company} placement details`}
    >
      {swipeLabel && <span className={`mpc-swipe-label ${swipeSide === 'left' ? 'left' : 'right'}`}>{swipeLabel}</span>}
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
