import type { LoopCandidate } from '../domain/analysis'
import type { AudioAssetMetadata } from '../domain/audio'
import { formatDuration } from './format'

export class WaveformView {
  private readonly canvas: HTMLCanvasElement
  private readonly playhead: HTMLElement
  private readonly context: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver
  private metadata: AudioAssetMetadata | undefined
  private candidate: LoopCandidate | undefined

  constructor(canvas: HTMLCanvasElement, playhead: HTMLElement) {
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('This browser cannot render the waveform canvas.')
    }
    this.canvas = canvas
    this.playhead = playhead
    this.context = context
    this.resizeObserver = new ResizeObserver(() => this.draw())
    this.resizeObserver.observe(canvas)
  }

  setAudio(metadata: AudioAssetMetadata | undefined): void {
    this.metadata = metadata
    this.candidate = undefined
    this.setPlayhead(undefined)
    this.draw()
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
