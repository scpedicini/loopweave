import type { PlaybackPosition, PlaybackState } from '../infrastructure/playback/LoopPlayer'
import { formatDuration } from './format'

export type PlaybackPositionProvider = () => PlaybackPosition | undefined

interface LoopMeterElements {
  readonly card: HTMLElement
  readonly meter: HTMLElement
  readonly progress: SVGCircleElement
  readonly seamMarker: SVGGElement
  readonly seamLabel: HTMLElement
  readonly playhead: SVGGElement
  readonly elapsed: HTMLElement
  readonly total: HTMLElement
  readonly status: HTMLElement
}

const NORMALIZED_CIRCUMFERENCE = 100
const SEAM_PULSE_MILLISECONDS = 320

export class LoopProgressView {
  private readonly root: HTMLElement
  private readonly readPosition: PlaybackPositionProvider
  private active: LoopMeterElements | undefined
  private activeMode: PlaybackState['mode']
  private animationFrameId: number | undefined
  private seamPulseTimer: number | undefined
  private lastCompletedSeams = -1

  constructor(root: HTMLElement, readPosition: PlaybackPositionProvider) {
    this.root = root
    this.readPosition = readPosition
  }

  setPlaybackState(state: PlaybackState): void {
    if (!state.playing) {
      this.stop()
      return
    }
    if (
      this.active?.card.dataset.candidateId === state.candidateId &&
      this.activeMode === state.mode
    ) {
      return
    }

    this.stop()
    const active = this.findMeter(state.candidateId)
    if (active === undefined) {
      return
    }
    const seamProgress = state.seamAtSeconds / state.loopDurationSeconds
    active.meter.classList.toggle('is-seam-audition', state.mode === 'seam')
    active.seamMarker.setAttribute('transform', `rotate(${seamProgress * 360} 40 40)`)
    active.seamLabel.textContent = state.mode === 'seam' ? 'SEAM' : 'START / SEAM'
    active.total.textContent =
      state.mode === 'seam'
        ? `±${formatDuration(state.seamAtSeconds)}`
        : `of ${formatDuration(state.loopDurationSeconds)}`
    this.active = active
    this.activeMode = state.mode
    this.lastCompletedSeams = state.mode === 'seam' ? 0 : -1
    this.drawFrame()
  }

  stop(): void {
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = undefined
    }
    if (this.seamPulseTimer !== undefined) {
      window.clearTimeout(this.seamPulseTimer)
      this.seamPulseTimer = undefined
    }
    if (this.active !== undefined) {
      this.active.card.classList.remove('is-seam-hit')
      this.active.meter.classList.remove('is-seam-audition')
      this.active.progress.style.strokeDashoffset = String(NORMALIZED_CIRCUMFERENCE)
      this.active.seamMarker.setAttribute('transform', 'rotate(0 40 40)')
      this.active.seamLabel.textContent = 'START / SEAM'
      this.active.playhead.setAttribute('transform', 'rotate(0 40 40)')
      this.active.elapsed.textContent = '0.0s'
      const loopDuration = Number.parseFloat(this.active.meter.dataset.loopDuration ?? '')
      if (Number.isFinite(loopDuration)) {
        const duration = formatDuration(loopDuration)
        this.active.total.textContent = `of ${duration}`
        this.active.status.textContent = `↻ LOOP 1 · 0.0s / ${duration}`
      }
      this.active.meter.setAttribute('aria-valuenow', '0')
      this.active.meter.setAttribute('aria-valuetext', 'Playback stopped')
    }
    this.active = undefined
    this.activeMode = undefined
    this.lastCompletedSeams = -1
  }

  private readonly drawFrame = (): void => {
    const active = this.active
    const position = this.readPosition()
    if (active === undefined || position === undefined) {
      return
    }
    if (active.card.dataset.candidateId !== position.candidateId) {
      return
    }

    const progress = Math.min(1, Math.max(0, position.progress))
    const isSeamAudition = position.mode === 'seam'
    const relativeToSeamSeconds = position.elapsedInLoopSeconds - position.seamAtSeconds
    const elapsed = isSeamAudition
      ? this.formatSeamOffset(relativeToSeamSeconds)
      : formatDuration(position.elapsedInLoopSeconds)
    const duration = formatDuration(position.loopDurationSeconds)
    active.progress.style.strokeDashoffset = String(NORMALIZED_CIRCUMFERENCE * (1 - progress))
    active.playhead.setAttribute('transform', `rotate(${progress * 360} 40 40)`)
    active.elapsed.textContent = elapsed
    active.status.textContent = isSeamAudition
      ? `◎ SEAM PASS ${position.completedLoops + 1} · ${elapsed}`
      : `↻ LOOP ${position.completedLoops + 1} · ${elapsed} / ${duration}`
    active.meter.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
    active.meter.setAttribute(
      'aria-valuetext',
      isSeamAudition
        ? this.seamAriaValue(relativeToSeamSeconds)
        : `Loop ${position.completedLoops + 1}, ${elapsed} of ${duration}`,
    )

    if (position.completedSeams !== this.lastCompletedSeams) {
      this.lastCompletedSeams = position.completedSeams
      this.pulseSeam(active.card)
    }
    this.animationFrameId = requestAnimationFrame(this.drawFrame)
  }

  private pulseSeam(card: HTMLElement): void {
    if (this.seamPulseTimer !== undefined) {
      window.clearTimeout(this.seamPulseTimer)
    }
    card.classList.add('is-seam-hit')
    this.seamPulseTimer = window.setTimeout(() => {
      card.classList.remove('is-seam-hit')
      this.seamPulseTimer = undefined
    }, SEAM_PULSE_MILLISECONDS)
  }

  private formatSeamOffset(relativeSeconds: number): string {
    if (Math.abs(relativeSeconds) < 0.05) {
      return '0.0s'
    }
    const sign = relativeSeconds < 0 ? '−' : '+'
    return `${sign}${formatDuration(Math.abs(relativeSeconds))}`
  }

  private seamAriaValue(relativeSeconds: number): string {
    if (Math.abs(relativeSeconds) < 0.05) {
      return 'At the loop seam'
    }
    const relation = relativeSeconds < 0 ? 'before' : 'after'
    return `${formatDuration(Math.abs(relativeSeconds))} ${relation} the loop seam`
  }

  private findMeter(candidateId: string): LoopMeterElements | undefined {
    const card = Array.from(this.root.querySelectorAll<HTMLElement>('[data-candidate-id]')).find(
      (item) => item.dataset.candidateId === candidateId,
    )
    const meter = card?.querySelector<HTMLElement>('[data-loop-meter]')
    const progress = card?.querySelector<SVGCircleElement>('[data-loop-progress]')
    const seamMarker = card?.querySelector<SVGGElement>('[data-loop-seam-marker]')
    const seamLabel = card?.querySelector<HTMLElement>('.loop-seam-label')
    const playhead = card?.querySelector<SVGGElement>('[data-loop-playhead]')
    const elapsed = card?.querySelector<HTMLElement>('[data-loop-elapsed]')
    const total = card?.querySelector<HTMLElement>('[data-loop-total]')
    const status = card?.querySelector<HTMLElement>('[data-loop-status]')
    if (
      card === undefined ||
      meter === null ||
      meter === undefined ||
      progress === null ||
      progress === undefined ||
      seamMarker === null ||
      seamMarker === undefined ||
      seamLabel === null ||
      seamLabel === undefined ||
      playhead === null ||
      playhead === undefined ||
      elapsed === null ||
      elapsed === undefined ||
      total === null ||
      total === undefined ||
      status === null ||
      status === undefined
    ) {
      return undefined
    }
    return { card, meter, progress, seamMarker, seamLabel, playhead, elapsed, total, status }
  }
}
