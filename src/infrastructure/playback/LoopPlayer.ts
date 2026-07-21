import type { RenderedLoop } from '../../domain/analysis'
import type { MutablePlanarAudio, PlanarAudio } from '../../domain/audio'

export const SEAM_AUDITION_FLANK_SECONDS = 5

export type PlaybackMode = 'loop' | 'seam'

export type PlaybackState =
  | {
      readonly playing: false
      readonly candidateId: undefined
      readonly loopDurationSeconds: undefined
      readonly mode: undefined
      readonly seamAtSeconds: undefined
    }
  | {
      readonly playing: true
      readonly candidateId: string
      readonly loopDurationSeconds: number
      readonly mode: PlaybackMode
      readonly seamAtSeconds: number
    }

export type PlaybackListener = (state: PlaybackState) => void

export interface PlaybackPosition {
  readonly candidateId: string
  readonly loopDurationSeconds: number
  readonly elapsedInLoopSeconds: number
  readonly completedLoops: number
  readonly completedSeams: number
  readonly mode: PlaybackMode
  readonly progress: number
  readonly seamAtSeconds: number
}

export function createSeamAuditionAudio(audio: PlanarAudio): MutablePlanarAudio {
  const flankSamples = Math.min(
    Math.round(audio.sampleRate * SEAM_AUDITION_FLANK_SECONDS),
    Math.floor(audio.lengthSamples / 2),
  )
  const auditionLengthSamples = flankSamples * 2
  if (flankSamples < 1) {
    throw new Error('Seam audition requires a rendered loop containing at least two samples.')
  }

  const channels = audio.channels.map((channel) => {
    if (channel.length < audio.lengthSamples) {
      throw new Error('Rendered loop channel is shorter than its declared length.')
    }
    const auditionChannel = new Float32Array(auditionLengthSamples)
    auditionChannel.set(channel.subarray(audio.lengthSamples - flankSamples, audio.lengthSamples))
    auditionChannel.set(channel.subarray(0, flankSamples), flankSamples)
    return auditionChannel
  })

  return {
    sampleRate: audio.sampleRate,
    lengthSamples: auditionLengthSamples,
    channels,
  }
}

export class LoopPlayer {
  private context: AudioContext | undefined
  private source: AudioBufferSourceNode | undefined
  private activeCandidateId: string | undefined
  private activeLoopDurationSeconds: number | undefined
  private activeMode: PlaybackMode | undefined
  private activeSeamAtSeconds: number | undefined
  private startedAtContextTimeSeconds: number | undefined
  private readonly listener: PlaybackListener

  constructor(listener: PlaybackListener) {
    this.listener = listener
  }

  get playbackState(): PlaybackState {
    if (
      this.activeCandidateId !== undefined &&
      this.activeLoopDurationSeconds !== undefined &&
      this.activeMode !== undefined &&
      this.activeSeamAtSeconds !== undefined
    ) {
      return {
        playing: true,
        candidateId: this.activeCandidateId,
        loopDurationSeconds: this.activeLoopDurationSeconds,
        mode: this.activeMode,
        seamAtSeconds: this.activeSeamAtSeconds,
      }
    }
    return {
      playing: false,
      candidateId: undefined,
      loopDurationSeconds: undefined,
      mode: undefined,
      seamAtSeconds: undefined,
    }
  }

  get playbackPosition(): PlaybackPosition | undefined {
    const context = this.context
    const candidateId = this.activeCandidateId
    const loopDurationSeconds = this.activeLoopDurationSeconds
    const mode = this.activeMode
    const seamAtSeconds = this.activeSeamAtSeconds
    const startedAtContextTimeSeconds = this.startedAtContextTimeSeconds
    if (
      context === undefined ||
      candidateId === undefined ||
      loopDurationSeconds === undefined ||
      mode === undefined ||
      seamAtSeconds === undefined ||
      startedAtContextTimeSeconds === undefined
    ) {
      return undefined
    }

    const totalElapsedSeconds = Math.max(0, context.currentTime - startedAtContextTimeSeconds)
    const completedLoops = Math.floor(totalElapsedSeconds / loopDurationSeconds)
    const elapsedInLoopSeconds = totalElapsedSeconds - completedLoops * loopDurationSeconds
    const completedSeams =
      seamAtSeconds === 0
        ? completedLoops
        : Math.floor(
            (totalElapsedSeconds + loopDurationSeconds - seamAtSeconds) / loopDurationSeconds,
          )
    return {
      candidateId,
      loopDurationSeconds,
      elapsedInLoopSeconds,
      completedLoops,
      completedSeams,
      mode,
      progress: elapsedInLoopSeconds / loopDurationSeconds,
      seamAtSeconds,
    }
  }

  async play(rendered: RenderedLoop, mode: PlaybackMode = 'loop'): Promise<void> {
    this.stop()
    const context = this.audioContext()
    if (context.state === 'suspended') {
      await context.resume()
    }
    const audio = mode === 'seam' ? createSeamAuditionAudio(rendered.audio) : rendered.audio
    const buffer = context.createBuffer(
      audio.channels.length,
      audio.lengthSamples,
      audio.sampleRate,
    )
    for (let channelIndex = 0; channelIndex < audio.channels.length; channelIndex += 1) {
      const channel = audio.channels[channelIndex]
      if (channel !== undefined) {
        buffer.copyToChannel(new Float32Array(channel), channelIndex)
      }
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(context.destination)
    const startedAtContextTimeSeconds = context.currentTime
    source.start(startedAtContextTimeSeconds)
    source.addEventListener('ended', () => {
      if (this.source === source) {
        this.source = undefined
        this.activeCandidateId = undefined
        this.activeLoopDurationSeconds = undefined
        this.activeMode = undefined
        this.activeSeamAtSeconds = undefined
        this.startedAtContextTimeSeconds = undefined
        this.listener(this.playbackState)
      }
    })
    this.source = source
    this.activeCandidateId = rendered.candidate.candidateId
    this.activeLoopDurationSeconds = buffer.duration
    this.activeMode = mode
    this.activeSeamAtSeconds = mode === 'seam' ? buffer.duration / 2 : 0
    this.startedAtContextTimeSeconds = startedAtContextTimeSeconds
    this.listener(this.playbackState)
  }

  stop(): void {
    const source = this.source
    this.source = undefined
    this.activeCandidateId = undefined
    this.activeLoopDurationSeconds = undefined
    this.activeMode = undefined
    this.activeSeamAtSeconds = undefined
    this.startedAtContextTimeSeconds = undefined
    if (source !== undefined) {
      source.stop()
      source.disconnect()
    }
    this.listener(this.playbackState)
  }

  async close(): Promise<void> {
    this.stop()
    if (this.context !== undefined && this.context.state !== 'closed') {
      await this.context.close()
    }
    this.context = undefined
  }

  private audioContext(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: 'playback' })
    return this.context
  }
}
