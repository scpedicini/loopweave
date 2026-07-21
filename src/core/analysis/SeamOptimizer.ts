import type {
  CandidateDiagnostic,
  CandidateScoreBreakdown,
  ConfidenceLevel,
  ContentProfile,
  CrossfadeRenderer,
  FadeCurve,
  LoopAnalysisOptions,
  LoopCandidate,
  SeamRenderer,
} from '../../domain/analysis'
import type { PlanarAudio } from '../../domain/audio'
import { LoopRenderer } from '../audio/LoopRenderer'
import { clamp, median } from '../dsp/math'
import type { CoarseCandidate } from './CandidateGenerator'

interface RefinedCandidate {
  readonly startSample: number
  readonly endSample: number
  readonly renderer: SeamRenderer
  readonly seamCost: number
  readonly modificationCost: number
  readonly totalCost: number
  readonly coarse: CoarseCandidate
}

interface RendererEvaluation {
  readonly renderer: SeamRenderer
  readonly seamCost: number
  readonly modificationCost: number
  readonly combinedCost: number
}

export type RefineProgress = (fraction: number) => void

export class SeamOptimizer {
  private readonly renderer = new LoopRenderer()

  optimize(
    sessionId: string,
    source: PlanarAudio,
    coarseCandidates: readonly CoarseCandidate[],
    profile: ContentProfile,
    options: LoopAnalysisOptions,
    onProgress?: RefineProgress,
  ): readonly LoopCandidate[] {
    const refined: RefinedCandidate[] = []
    for (let index = 0; index < coarseCandidates.length; index += 1) {
      const coarse = coarseCandidates[index]
      if (coarse === undefined) {
        continue
      }
      const initialStart = clamp(
        Math.round(coarse.startSeconds * source.sampleRate),
        1,
        source.lengthSamples - 2,
      )
      const initialEnd = clamp(
        Math.round(coarse.endSeconds * source.sampleRate),
        initialStart + 2,
        source.lengthSamples - 1,
      )
      const { startSample, endSample } = this.refineEndpoints(
        source,
        initialStart,
        initialEnd,
        profile,
      )
      const rendererEvaluation = this.chooseRenderer(source, startSample, endSample, profile)
      const totalCost = coarse.coarseCost * 0.72 + rendererEvaluation.combinedCost * 0.28
      refined.push({
        startSample,
        endSample,
        renderer: rendererEvaluation.renderer,
        seamCost: rendererEvaluation.seamCost,
        modificationCost: rendererEvaluation.modificationCost,
        totalCost,
        coarse,
      })
      onProgress?.((index + 1) / Math.max(1, coarseCandidates.length))
    }

    const sorted = refined.sort((left, right) => left.totalCost - right.totalCost)
    const selected = this.selectFinalCandidates(sorted, options.candidateCount, source.sampleRate)
    const medianDuration = median(
      selected.map(
        (candidate) => (candidate.endSample - candidate.startSample) / source.sampleRate,
      ),
    )

    return selected.map((candidate, index) =>
      this.toLoopCandidate(sessionId, source, candidate, index, medianDuration),
    )
  }

  private refineEndpoints(
    source: PlanarAudio,
    initialStart: number,
    initialEnd: number,
    profile: ContentProfile,
  ): { readonly startSample: number; readonly endSample: number } {
    const loopLength = initialEnd - initialStart
    const endRadius = Math.min(Math.round(source.sampleRate * 0.1), Math.floor(loopLength * 0.08))
    const coarseStep = Math.max(2, Math.round(source.sampleRate / 3_000))
    const minimumLength = Math.max(2, Math.floor(loopLength * 0.8))
    let endSample = this.searchPosition(
      initialEnd,
      Math.max(initialStart + minimumLength, initialEnd - endRadius),
      Math.min(source.lengthSamples - 1, initialEnd + endRadius),
      coarseStep,
      (position) => this.boundaryCost(source, initialStart, position, profile),
    )

    const startRadius = Math.min(
      Math.round(source.sampleRate * 0.025),
      Math.floor(loopLength * 0.02),
    )
    const startSample = this.searchPosition(
      initialStart,
      Math.max(1, initialStart - startRadius),
      Math.min(endSample - minimumLength, initialStart + startRadius),
      Math.max(1, Math.floor(coarseStep / 2)),
      (position) => this.boundaryCost(source, position, endSample, profile),
    )

    endSample = this.searchPosition(
      endSample,
      Math.max(startSample + minimumLength, endSample - coarseStep * 2),
      Math.min(source.lengthSamples - 1, endSample + coarseStep * 2),
      1,
      (position) => this.boundaryCost(source, startSample, position, profile),
    )

    return { startSample, endSample }
  }

  private searchPosition(
    fallback: number,
    minimum: number,
    maximum: number,
    step: number,
    cost: (position: number) => number,
  ): number {
    if (minimum > maximum) {
      return fallback
    }
    let bestPosition = clamp(fallback, minimum, maximum)
    let bestCost = cost(bestPosition)
    for (let position = minimum; position <= maximum; position += Math.max(1, step)) {
      const candidateCost = cost(position)
      if (candidateCost < bestCost) {
        bestCost = candidateCost
        bestPosition = position
      }
    }
    return bestPosition
  }

  private boundaryCost(
    source: PlanarAudio,
    start: number,
    end: number,
    profile: ContentProfile,
  ): number {
    const windowSamples = Math.max(24, Math.round(source.sampleRate * 0.006))
    let sampleCost = 0
    let slopeCost = 0
    let rmsCost = 0
    let correlationCost = 0

    for (const channel of source.channels) {
      const tailRms = this.windowRms(channel, end - windowSamples, end)
      const headRms = this.windowRms(channel, start, start + windowSamples)
      const scale = Math.max(0.005, (tailRms + headRms) / 2)
      const tail = channel[end - 1] ?? 0
      const head = channel[start] ?? 0
      const tailSlope = tail - (channel[end - 2] ?? tail)
      const headSlope = (channel[start + 1] ?? head) - head
      sampleCost += Math.min(3, Math.abs(tail - head) / scale)
      slopeCost += Math.min(3, Math.abs(tailSlope - headSlope) / scale)
      rmsCost += Math.abs(Math.log((tailRms + 1e-6) / (headRms + 1e-6)))
      correlationCost +=
        1 - this.centeredCorrelation(channel, start, end, Math.floor(windowSamples / 2))
    }

    const channelCount = Math.max(1, source.channels.length)
    const tonalityWeight = 0.08 + profile.tonality * 0.22
    return (
      (sampleCost / channelCount) * 0.36 +
      (slopeCost / channelCount) * 0.22 +
      (rmsCost / channelCount) * 0.2 +
      (correlationCost / channelCount) * tonalityWeight
    )
  }

  private chooseRenderer(
    source: PlanarAudio,
    start: number,
    end: number,
    profile: ContentProfile,
  ): RendererEvaluation {
    const hardSeamCost = this.boundaryCost(source, start, end, profile)
    let best: RendererEvaluation = {
      renderer: { kind: 'hard-cut', outputGain: 1 },
      seamCost: hardSeamCost,
      modificationCost: 0,
      combinedCost: hardSeamCost,
    }
    const loopLength = end - start

    for (const fadeSeconds of this.fadeDurations(profile)) {
      const fadeSamples = clamp(
        Math.round(fadeSeconds * source.sampleRate),
        8,
        Math.floor(loopLength / 4),
      )
      if (fadeSamples < 8) {
        continue
      }
      const correlation = this.overlapCorrelation(source, start, end, fadeSamples)
      for (const curve of this.fadeCurves(correlation)) {
        const evaluation = this.evaluateCrossfade(
          source,
          start,
          end,
          fadeSamples,
          curve,
          correlation,
          profile,
        )
        if (evaluation.combinedCost < best.combinedCost) {
          best = evaluation
        }
      }
    }
    return best
  }

  private evaluateCrossfade(
    source: PlanarAudio,
    start: number,
    end: number,
    fadeSamples: number,
    curve: FadeCurve,
    correlation: number,
    profile: ContentProfile,
  ): RendererEvaluation {
    const stride = Math.max(1, Math.floor(fadeSamples / 2_048))
    const denominator = Math.max(1, fadeSamples - 1)
    let tailPower = 0
    let headPower = 0
    let mixedPower = 0
    let peak = 0
    let sampleCount = 0

    for (const channel of source.channels) {
      for (let index = 0; index < fadeSamples; index += stride) {
        const tail = channel[end - fadeSamples + index] ?? 0
        const head = channel[start + index] ?? 0
        const weights = this.renderer.weights(curve, index / denominator, correlation)
        const mixed = tail * weights.outgoing + head * weights.incoming
        tailPower += tail * tail
        headPower += head * head
        mixedPower += mixed * mixed
        peak = Math.max(peak, Math.abs(mixed))
        sampleCount += 1
      }
    }

    const expectedPower = (tailPower + headPower) / Math.max(1, sampleCount * 2)
    const actualPower = mixedPower / Math.max(1, sampleCount)
    const powerDeviation = Math.abs(Math.log((actualPower + 1e-8) / (expectedPower + 1e-8)))
    const negativeCorrelationPenalty = Math.max(0, -correlation - 0.2)
    const seamCost = powerDeviation * 0.58 + negativeCorrelationPenalty * 0.38
    const fadeFraction = fadeSamples / Math.max(1, end - start)
    const modificationCost =
      fadeFraction * (0.7 + profile.transientDensity * 0.9) + Math.max(0, peak - 0.99) * 0.4
    const outputGain = peak > 0.99 ? 0.99 / peak : 1
    const renderer: CrossfadeRenderer = {
      kind: 'crossfade',
      fadeSamples,
      fadeSeconds: fadeSamples / source.sampleRate,
      curve,
      correlation,
      outputGain,
    }

    return {
      renderer,
      seamCost,
      modificationCost,
      combinedCost: seamCost * 0.78 + modificationCost * 0.22,
    }
  }

  private fadeDurations(profile: ContentProfile): readonly number[] {
    if (profile.regime === 'texture') {
      return [0.08, 0.2, 0.5, 1, 1.8]
    }
    if (profile.regime === 'tonal') {
      return [0.006, 0.015, 0.04, 0.1, 0.25]
    }
    if (profile.regime === 'rhythmic') {
      return [0.006, 0.02, 0.06, 0.14]
    }
    return [0.012, 0.05, 0.16, 0.4, 0.8]
  }

  private fadeCurves(correlation: number): readonly FadeCurve[] {
    if (correlation > 0.58) {
      return ['linear', 'correlation-matched']
    }
    if (Math.abs(correlation) < 0.2) {
      return ['equal-power', 'correlation-matched']
    }
    return ['correlation-matched', 'equal-power']
  }

  private overlapCorrelation(
    source: PlanarAudio,
    start: number,
    end: number,
    length: number,
  ): number {
    const stride = Math.max(1, Math.floor(length / 2_048))
    let cross = 0
    let tailEnergy = 0
    let headEnergy = 0
    for (const channel of source.channels) {
      for (let index = 0; index < length; index += stride) {
        const tail = channel[end - length + index] ?? 0
        const head = channel[start + index] ?? 0
        cross += tail * head
        tailEnergy += tail * tail
        headEnergy += head * head
      }
    }
    return clamp(cross / Math.sqrt(tailEnergy * headEnergy + 1e-12), -1, 1)
  }

  private centeredCorrelation(
    channel: Float32Array,
    start: number,
    end: number,
    radius: number,
  ): number {
    let cross = 0
    let startEnergy = 0
    let endEnergy = 0
    for (let offset = -radius; offset <= radius; offset += 2) {
      const startSample = channel[start + offset] ?? 0
      const endSample = channel[end + offset] ?? 0
      cross += startSample * endSample
      startEnergy += startSample * startSample
      endEnergy += endSample * endSample
    }
    return clamp(cross / Math.sqrt(startEnergy * endEnergy + 1e-12), -1, 1)
  }

  private windowRms(channel: Float32Array, start: number, end: number): number {
    let energy = 0
    let count = 0
    const safeStart = clamp(start, 0, channel.length)
    const safeEnd = clamp(end, safeStart, channel.length)
    for (let index = safeStart; index < safeEnd; index += 1) {
      const sample = channel[index] ?? 0
      energy += sample * sample
      count += 1
    }
    return Math.sqrt(energy / Math.max(1, count))
  }

  private selectFinalCandidates(
    candidates: readonly RefinedCandidate[],
    count: number,
    sampleRate: number,
  ): readonly RefinedCandidate[] {
    const selected: RefinedCandidate[] = []
    for (const candidate of candidates) {
      const duration = (candidate.endSample - candidate.startSample) / sampleRate
      const distinct = selected.every((existing) => {
        const existingDuration = (existing.endSample - existing.startSample) / sampleRate
        const endpointDistance =
          Math.abs(existing.startSample - candidate.startSample) / sampleRate +
          Math.abs(existing.endSample - candidate.endSample) / sampleRate
        return endpointDistance > 0.35 || Math.abs(existingDuration - duration) > 0.65
      })
      if (distinct) {
        selected.push(candidate)
      }
      if (selected.length >= count) {
        break
      }
    }
    return selected
  }

  private toLoopCandidate(
    sessionId: string,
    source: PlanarAudio,
    candidate: RefinedCandidate,
    index: number,
    medianDuration: number,
  ): LoopCandidate {
    const rank = index + 1
    const sourceDurationSeconds = (candidate.endSample - candidate.startSample) / source.sampleRate
    const fadeSeconds = candidate.renderer.kind === 'crossfade' ? candidate.renderer.fadeSeconds : 0
    const loopDurationSeconds = sourceDurationSeconds - fadeSeconds
    const qualityScore = clamp(Math.round(100 * Math.exp(-candidate.totalCost * 0.62)), 1, 99)
    const scores: CandidateScoreBreakdown = {
      recurrence: candidate.coarse.recurrenceCost,
      stationarity: candidate.coarse.stationarityCost,
      rareEvent: candidate.coarse.rareEventCost,
      trajectory: candidate.coarse.trajectoryCost,
      seam: candidate.seamCost,
      modification: candidate.modificationCost,
      total: candidate.totalCost,
    }
    const candidateId = [
      sessionId,
      candidate.startSample,
      candidate.endSample,
      candidate.renderer.kind === 'crossfade' ? candidate.renderer.fadeSamples : 0,
    ].join(':')

    return {
      candidateId,
      rank,
      label: this.candidateLabel(rank, sourceDurationSeconds, medianDuration, candidate.renderer),
      startSample: candidate.startSample,
      endSample: candidate.endSample,
      startSeconds: candidate.startSample / source.sampleRate,
      endSeconds: candidate.endSample / source.sampleRate,
      sourceDurationSeconds,
      loopDurationSeconds,
      qualityScore,
      confidence: this.confidence(qualityScore),
      renderer: candidate.renderer,
      scores,
      diagnostics: this.diagnostics(candidate, sourceDurationSeconds),
    }
  }

  private confidence(qualityScore: number): ConfidenceLevel {
    if (qualityScore >= 78) {
      return 'high'
    }
    if (qualityScore >= 60) {
      return 'medium'
    }
    return 'low'
  }

  private candidateLabel(
    rank: number,
    duration: number,
    medianDuration: number,
    renderer: SeamRenderer,
  ): string {
    if (rank === 1) {
      return 'Best overall'
    }
    if (renderer.kind === 'hard-cut') {
      return 'Minimal processing'
    }
    if (duration > medianDuration * 1.2) {
      return 'Long-form texture'
    }
    if (renderer.fadeSeconds < 0.05) {
      return 'Phase-conscious seam'
    }
    return 'Smooth transition'
  }

  private diagnostics(
    candidate: RefinedCandidate,
    durationSeconds: number,
  ): readonly CandidateDiagnostic[] {
    const diagnostics: CandidateDiagnostic[] = []
    if (candidate.renderer.kind === 'hard-cut') {
      diagnostics.push({
        code: 'source-pure',
        tone: 'positive',
        message: 'Endpoint alignment was clean enough to avoid a crossfade.',
      })
    } else {
      diagnostics.push({
        code: 'adaptive-fade',
        tone: 'neutral',
        message: `${Math.round(candidate.renderer.fadeSeconds * 1_000)} ms ${candidate.renderer.curve.replace('-', ' ')} crossfade baked into the loop.`,
      })
    }
    if (candidate.coarse.rareEventCost > 0.75) {
      diagnostics.push({
        code: 'salient-event',
        tone: 'warning',
        message: 'The interval contains a comparatively salient change that may reveal repetition.',
      })
    } else {
      diagnostics.push({
        code: 'stable-interior',
        tone: 'positive',
        message: 'The interior is comparatively stable over the selected interval.',
      })
    }
    if (
      candidate.renderer.kind === 'crossfade' &&
      candidate.renderer.fadeSeconds / durationSeconds > 0.12
    ) {
      diagnostics.push({
        code: 'heavy-treatment',
        tone: 'warning',
        message: 'A meaningful portion of this candidate is overlap-processed.',
      })
    }
    return diagnostics
  }
}
