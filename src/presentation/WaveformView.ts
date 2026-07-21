import type { LoopCandidate } from '../domain/analysis'
import type { AudioAssetMetadata } from '../domain/audio'
import { formatDuration } from './format'

export interface WaveformSearchRange {
  readonly startSeconds: number
  readonly endSeconds: number
}

export interface WaveformRangeControls {
  readonly overlay: HTMLElement
  readonly leftMask: HTMLElement
  readonly rightMask: HTMLElement
  readonly startHandle: HTMLButtonElement
  readonly endHandle: HTMLButtonElement
  readonly window: HTMLButtonElement
  readonly value: HTMLElement
  readonly resetButton: HTMLButtonElement
}

type RangeDragTarget = 'start' | 'end' | 'window'

interface RangeDrag {
  readonly target: RangeDragTarget
  readonly pointerId: number
  readonly startClientX: number
  readonly initialRange: WaveformSearchRange
}

export class WaveformView {
  private readonly canvas: HTMLCanvasElement
  private readonly playhead: HTMLElement
  private readonly rangeControls: WaveformRangeControls
  private readonly onSearchRangeCommit: () => void
  private readonly context: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver
  private metadata: AudioAssetMetadata | undefined
  private candidate: LoopCandidate | undefined
  private searchRange: WaveformSearchRange | undefined
  private rangeDrag: RangeDrag | undefined
  private disabled = false

  constructor(
    canvas: HTMLCanvasElement,
    playhead: HTMLElement,
    rangeControls: WaveformRangeControls,
    onSearchRangeCommit: () => void,
  ) {
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('This browser cannot render the waveform canvas.')
    }
    this.canvas = canvas
    this.playhead = playhead
    this.rangeControls = rangeControls
    this.onSearchRangeCommit = onSearchRangeCommit
    this.context = context
    this.resizeObserver = new ResizeObserver(() => this.draw())
    this.resizeObserver.observe(canvas)
    rangeControls.startHandle.addEventListener('pointerdown', this.handleRangePointerDown)
    rangeControls.endHandle.addEventListener('pointerdown', this.handleRangePointerDown)
    rangeControls.window.addEventListener('pointerdown', this.handleRangePointerDown)
    rangeControls.startHandle.addEventListener('keydown', this.handleRangeKeydown)
    rangeControls.endHandle.addEventListener('keydown', this.handleRangeKeydown)
    rangeControls.window.addEventListener('keydown', this.handleRangeKeydown)
    rangeControls.resetButton.addEventListener('click', this.resetSearchRange)
  }

  setAudio(metadata: AudioAssetMetadata | undefined): void {
    this.metadata = metadata
    this.candidate = undefined
    this.searchRange =
      metadata === undefined ? undefined : { startSeconds: 0, endSeconds: metadata.durationSeconds }
    this.setPlayhead(undefined)
    this.renderRangeControls()
    this.draw()
  }

  getSearchRange(): WaveformSearchRange | undefined {
    return this.searchRange
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled
    this.renderRangeControls()
  }

  setCandidate(candidate: LoopCandidate | undefined): void {
    this.candidate = candidate
    this.draw()
  }

  setPlayhead(sourceTimeSeconds: number | undefined): void {
    const metadata = this.metadata
    if (
      metadata === undefined ||
      sourceTimeSeconds === undefined ||
      !Number.isFinite(sourceTimeSeconds)
    ) {
      this.playhead.hidden = true
      return
    }
    const progress = Math.min(1, Math.max(0, sourceTimeSeconds / metadata.durationSeconds))
    this.playhead.style.left = `${progress * 100}%`
    this.playhead.hidden = false
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.rangeControls.startHandle.removeEventListener('pointerdown', this.handleRangePointerDown)
    this.rangeControls.endHandle.removeEventListener('pointerdown', this.handleRangePointerDown)
    this.rangeControls.window.removeEventListener('pointerdown', this.handleRangePointerDown)
    this.rangeControls.startHandle.removeEventListener('keydown', this.handleRangeKeydown)
    this.rangeControls.endHandle.removeEventListener('keydown', this.handleRangeKeydown)
    this.rangeControls.window.removeEventListener('keydown', this.handleRangeKeydown)
    this.rangeControls.resetButton.removeEventListener('click', this.resetSearchRange)
  }

  private readonly handleRangePointerDown = (event: PointerEvent): void => {
    if (this.disabled || event.button !== 0 || this.metadata === undefined) {
      return
    }
    const target = event.currentTarget
    if (!(target instanceof HTMLElement) || !this.isRangeDragTarget(target.dataset.rangeTarget)) {
      return
    }
    const initialRange = this.searchRange
    if (initialRange === undefined) {
      return
    }
    event.preventDefault()
    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', this.handleRangePointerMove)
    target.addEventListener('pointerup', this.handleRangePointerEnd)
    target.addEventListener('pointercancel', this.handleRangePointerCancel)
    target.classList.add('is-dragging')
    this.rangeControls.overlay.classList.add('is-dragging')
    this.rangeDrag = {
      target: target.dataset.rangeTarget,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      initialRange,
    }
  }

  private readonly handleRangePointerMove = (event: PointerEvent): void => {
    const drag = this.rangeDrag
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    this.updateRangeFromPointer(event.clientX, drag)
  }

  private readonly handleRangePointerEnd = (event: PointerEvent): void => {
    const drag = this.rangeDrag
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return
    }
    this.updateRangeFromPointer(event.clientX, drag)
    this.finishRangeDrag(event.currentTarget)
    if (!this.rangesMatch(drag.initialRange, this.searchRange)) {
      this.onSearchRangeCommit()
    }
  }

  private readonly handleRangePointerCancel = (event: PointerEvent): void => {
    const drag = this.rangeDrag
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return
    }
    this.searchRange = drag.initialRange
    this.renderRangeControls()
    this.finishRangeDrag(event.currentTarget)
  }

  private readonly handleRangeKeydown = (event: KeyboardEvent): void => {
    const metadata = this.metadata
    const range = this.searchRange
    const target = event.currentTarget
    if (
      this.disabled ||
      metadata === undefined ||
      range === undefined ||
      !(target instanceof HTMLElement) ||
      !this.isRangeDragTarget(target.dataset.rangeTarget)
    ) {
      return
    }

    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    const isEdgeKey = event.key === 'Home' || event.key === 'End'
    if (direction === 0 && !isEdgeKey) {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? 1 : Math.max(0.05, Math.min(0.25, metadata.durationSeconds / 200))
    const duration = range.endSeconds - range.startSeconds
    let nextRange = range

    if (target.dataset.rangeTarget === 'window') {
      const nextStart =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? metadata.durationSeconds - duration
            : range.startSeconds + direction * step
      const startSeconds = this.clamp(nextStart, 0, metadata.durationSeconds - duration)
      nextRange = { startSeconds, endSeconds: startSeconds + duration }
    } else if (target.dataset.rangeTarget === 'start') {
      const nextStart =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? range.endSeconds - this.minimumRangeSeconds(metadata.durationSeconds)
            : range.startSeconds + direction * step
      nextRange = {
        startSeconds: this.clamp(
          nextStart,
          0,
          range.endSeconds - this.minimumRangeSeconds(metadata.durationSeconds),
        ),
        endSeconds: range.endSeconds,
      }
    } else {
      const nextEnd =
        event.key === 'Home'
          ? range.startSeconds + this.minimumRangeSeconds(metadata.durationSeconds)
          : event.key === 'End'
            ? metadata.durationSeconds
            : range.endSeconds + direction * step
      nextRange = {
        startSeconds: range.startSeconds,
        endSeconds: this.clamp(
          nextEnd,
          range.startSeconds + this.minimumRangeSeconds(metadata.durationSeconds),
          metadata.durationSeconds,
        ),
      }
    }

    if (!this.rangesMatch(range, nextRange)) {
      this.searchRange = nextRange
      this.renderRangeControls()
      this.onSearchRangeCommit()
    }
  }

  private readonly resetSearchRange = (): void => {
    const metadata = this.metadata
    if (this.disabled || metadata === undefined) {
      return
    }
    const fullRange = { startSeconds: 0, endSeconds: metadata.durationSeconds }
    if (this.rangesMatch(this.searchRange, fullRange)) {
      return
    }
    this.searchRange = fullRange
    this.renderRangeControls()
    this.onSearchRangeCommit()
  }

  private updateRangeFromPointer(clientX: number, drag: RangeDrag): void {
    const metadata = this.metadata
    if (metadata === undefined) {
      return
    }
    const bounds = this.rangeControls.overlay.getBoundingClientRect()
    if (bounds.width <= 0) {
      return
    }
    const minimumRange = this.minimumRangeSeconds(metadata.durationSeconds)
    if (drag.target === 'window') {
      const deltaSeconds = ((clientX - drag.startClientX) / bounds.width) * metadata.durationSeconds
      const duration = drag.initialRange.endSeconds - drag.initialRange.startSeconds
      const startSeconds = this.clamp(
        drag.initialRange.startSeconds + deltaSeconds,
        0,
        metadata.durationSeconds - duration,
      )
      this.searchRange = { startSeconds, endSeconds: startSeconds + duration }
    } else {
      const pointerSeconds = this.clamp(
        ((clientX - bounds.left) / bounds.width) * metadata.durationSeconds,
        0,
        metadata.durationSeconds,
      )
      this.searchRange =
        drag.target === 'start'
          ? {
              startSeconds: Math.min(pointerSeconds, drag.initialRange.endSeconds - minimumRange),
              endSeconds: drag.initialRange.endSeconds,
            }
          : {
              startSeconds: drag.initialRange.startSeconds,
              endSeconds: Math.max(pointerSeconds, drag.initialRange.startSeconds + minimumRange),
            }
    }
    this.renderRangeControls()
  }

  private finishRangeDrag(eventTarget: EventTarget | null): void {
    if (eventTarget instanceof HTMLElement) {
      eventTarget.removeEventListener('pointermove', this.handleRangePointerMove)
      eventTarget.removeEventListener('pointerup', this.handleRangePointerEnd)
      eventTarget.removeEventListener('pointercancel', this.handleRangePointerCancel)
      eventTarget.classList.remove('is-dragging')
    }
    this.rangeControls.overlay.classList.remove('is-dragging')
    this.rangeDrag = undefined
  }

  private renderRangeControls(): void {
    const metadata = this.metadata
    const range = this.searchRange
    const controls = this.rangeControls
    controls.overlay.hidden = metadata === undefined || range === undefined
    if (metadata === undefined || range === undefined) {
      controls.value.textContent = 'Full source'
      controls.resetButton.disabled = true
      return
    }

    const startPercent = (range.startSeconds / metadata.durationSeconds) * 100
    const endPercent = (range.endSeconds / metadata.durationSeconds) * 100
    controls.leftMask.style.width = `${startPercent}%`
    controls.rightMask.style.left = `${endPercent}%`
    controls.startHandle.style.left = `${startPercent}%`
    controls.endHandle.style.left = `${endPercent}%`
    controls.window.style.left = `${startPercent}%`
    controls.window.style.width = `${endPercent - startPercent}%`

    const duration = range.endSeconds - range.startSeconds
    controls.value.textContent = `${formatDuration(range.startSeconds)} – ${formatDuration(range.endSeconds)} · ${formatDuration(duration)} available`
    this.setSliderAccessibility(
      controls.startHandle,
      0,
      range.endSeconds - this.minimumRangeSeconds(metadata.durationSeconds),
      range.startSeconds,
      `Range starts at ${formatDuration(range.startSeconds)}`,
    )
    this.setSliderAccessibility(
      controls.endHandle,
      range.startSeconds + this.minimumRangeSeconds(metadata.durationSeconds),
      metadata.durationSeconds,
      range.endSeconds,
      `Range ends at ${formatDuration(range.endSeconds)}`,
    )
    this.setSliderAccessibility(
      controls.window,
      0,
      metadata.durationSeconds - duration,
      range.startSeconds,
      `Allowed range ${formatDuration(range.startSeconds)} to ${formatDuration(range.endSeconds)}`,
    )

    for (const control of [controls.startHandle, controls.endHandle, controls.window]) {
      control.disabled = this.disabled
    }
    controls.resetButton.disabled =
      this.disabled ||
      this.rangesMatch(range, { startSeconds: 0, endSeconds: metadata.durationSeconds })
  }

  private setSliderAccessibility(
    element: HTMLElement,
    minimum: number,
    maximum: number,
    current: number,
    valueText: string,
  ): void {
    element.setAttribute('aria-valuemin', minimum.toFixed(3))
    element.setAttribute('aria-valuemax', maximum.toFixed(3))
    element.setAttribute('aria-valuenow', current.toFixed(3))
    element.setAttribute('aria-valuetext', valueText)
  }

  private minimumRangeSeconds(durationSeconds: number): number {
    return Math.min(0.75, durationSeconds)
  }

  private rangesMatch(
    left: WaveformSearchRange | undefined,
    right: WaveformSearchRange | undefined,
  ): boolean {
    return (
      left !== undefined &&
      right !== undefined &&
      Math.abs(left.startSeconds - right.startSeconds) < 1e-6 &&
      Math.abs(left.endSeconds - right.endSeconds) < 1e-6
    )
  }

  private isRangeDragTarget(value: string | undefined): value is RangeDragTarget {
    return value === 'start' || value === 'end' || value === 'window'
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
  }

  private draw(): void {
    const bounds = this.canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) {
      return
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(bounds.width * pixelRatio))
    const height = Math.max(1, Math.round(bounds.height * pixelRatio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const context = this.context
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, bounds.width, bounds.height)
    this.drawBackground(bounds.width, bounds.height)

    if (this.metadata === undefined) {
      return
    }
    this.drawGrid(bounds.width, bounds.height, this.metadata.durationSeconds)
    this.drawSelection(bounds.width, bounds.height)
    this.drawWaveform(bounds.width, bounds.height, 'rgba(222, 229, 238, 0.34)')

    if (this.candidate !== undefined) {
      const startX = (this.candidate.startSeconds / this.metadata.durationSeconds) * bounds.width
      const endX = (this.candidate.endSeconds / this.metadata.durationSeconds) * bounds.width
      context.save()
      context.beginPath()
      context.rect(startX, 0, endX - startX, bounds.height)
      context.clip()
      this.drawWaveform(bounds.width, bounds.height, '#d9fff4')
      context.restore()
      this.drawMarkers(bounds.width, bounds.height, startX, endX)
    }
  }

  private drawBackground(width: number, height: number): void {
    const gradient = this.context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#10151b')
    gradient.addColorStop(1, '#0a0d11')
    this.context.fillStyle = gradient
    this.context.fillRect(0, 0, width, height)
  }

  private drawGrid(width: number, height: number, duration: number): void {
    const context = this.context
    context.save()
    context.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    context.fillStyle = 'rgba(225, 234, 240, 0.48)'
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.textBaseline = 'bottom'
    for (let index = 0; index <= 5; index += 1) {
      const x = (width * index) / 5
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
      const label = formatDuration((duration * index) / 5, duration >= 60 ? 0 : 1)
      const labelWidth = context.measureText(label).width
      const labelX = Math.min(width - labelWidth - 5, Math.max(5, x + 5))
      context.fillText(label, labelX, height - 6)
    }
    context.beginPath()
    context.moveTo(0, height / 2)
    context.lineTo(width, height / 2)
    context.stroke()
    context.restore()
  }

  private drawSelection(width: number, height: number): void {
    const metadata = this.metadata
    const candidate = this.candidate
    if (metadata === undefined || candidate === undefined) {
      return
    }
    const startX = (candidate.startSeconds / metadata.durationSeconds) * width
    const endX = (candidate.endSeconds / metadata.durationSeconds) * width
    const gradient = this.context.createLinearGradient(startX, 0, endX, 0)
    gradient.addColorStop(0, 'rgba(100, 233, 196, 0.12)')
    gradient.addColorStop(0.5, 'rgba(155, 113, 255, 0.14)')
    gradient.addColorStop(1, 'rgba(100, 233, 196, 0.12)')
    this.context.fillStyle = gradient
    this.context.fillRect(startX, 0, endX - startX, height)

    if (candidate.renderer.kind === 'crossfade') {
      const fadeWidth = (candidate.renderer.fadeSeconds / metadata.durationSeconds) * width
      this.context.fillStyle = 'rgba(155, 113, 255, 0.16)'
      this.context.fillRect(startX, 0, Math.min(fadeWidth, endX - startX), height)
      this.context.fillRect(
        Math.max(startX, endX - fadeWidth),
        0,
        Math.min(fadeWidth, endX - startX),
        height,
      )
    }
  }

  private drawWaveform(width: number, height: number, color: string): void {
    const metadata = this.metadata
    if (metadata === undefined) {
      return
    }
    const { minimum, maximum } = metadata.waveform
    const center = height / 2
    const amplitude = height * 0.39
    const context = this.context
    context.beginPath()
    for (let index = 0; index < maximum.length; index += 1) {
      const x = (index / Math.max(1, maximum.length - 1)) * width
      const y = center - (maximum[index] ?? 0) * amplitude
      if (index === 0) {
        context.moveTo(x, y)
      } else {
        context.lineTo(x, y)
      }
    }
    for (let index = minimum.length - 1; index >= 0; index -= 1) {
      const x = (index / Math.max(1, minimum.length - 1)) * width
      const y = center - (minimum[index] ?? 0) * amplitude
      context.lineTo(x, y)
    }
    context.closePath()
    context.fillStyle = color
    context.fill()
  }

  private drawMarkers(width: number, height: number, startX: number, endX: number): void {
    const context = this.context
    context.save()
    context.strokeStyle = '#64e9c4'
    context.lineWidth = 1.5
    for (const x of [startX, endX]) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
    }
    context.fillStyle = '#64e9c4'
    context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.textBaseline = 'top'
    context.fillText('IN', Math.min(width - 18, startX + 5), 7)
    context.textAlign = 'right'
    context.fillText('OUT', Math.max(24, endX - 5), 7)
    context.restore()
  }
}
