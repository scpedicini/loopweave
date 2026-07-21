import type {
  AnalysisVerdict,
  EngineProgress,
  LoopAnalysisOptions,
  LoopAnalysisResult,
  LoopCandidate,
} from '../../domain/analysis'
import type { PlanarAudio } from '../../domain/audio'
import { clamp } from '../dsp/math'
import { CandidateGenerator } from './CandidateGenerator'
import { FeatureExtractor } from './FeatureExtractor'
import { SeamOptimizer } from './SeamOptimizer'

export type PipelineProgress = (progress: EngineProgress) => void

export class LocalLoopAnalysisPipeline {
  private readonly featureExtractor = new FeatureExtractor()
  private readonly candidateGenerator = new CandidateGenerator()
  private readonly seamOptimizer = new SeamOptimizer()

  analyze(
    sessionId: string,
    source: PlanarAudio,
    requestedOptions: LoopAnalysisOptions,
    onProgress?: PipelineProgress,
  ): LoopAnalysisResult {
    const startedAt = performance.now()
    const durationSeconds = source.lengthSamples / source.sampleRate
    if (durationSeconds < 0.75) {
      throw new Error('Please choose an audio file that is at least 0.75 seconds long.')
    }
    const options = this.normalizeOptions(requestedOptions, durationSeconds)

    onProgress?.({ stage: 'features', fraction: 0, message: 'Mapping acoustic texture' })
    const featureSequence = this.featureExtractor.extract(source, (fraction) => {
      onProgress?.({
        stage: 'features',
        fraction: fraction * 0.42,
        message: 'Mapping acoustic texture',
      })
    })

    onProgress?.({ stage: 'candidates', fraction: 0.43, message: 'Searching recurrent states' })
    const coarseCandidates = this.candidateGenerator.generate(
      featureSequence,
      options,
      (fraction) => {
        onProgress?.({
          stage: 'candidates',
          fraction: 0.43 + fraction * 0.32,
          message: 'Searching recurrent states',
        })
      },
    )

    onProgress?.({ stage: 'refining', fraction: 0.76, message: 'Optimizing seams and fades' })
    const candidates = this.seamOptimizer.optimize(
      sessionId,
      source,
      coarseCandidates,
      featureSequence.profile,
      options,
      (fraction) => {
        onProgress?.({
          stage: 'refining',
          fraction: 0.76 + fraction * 0.24,
          message: 'Optimizing seams and fades',
        })
      },
    )

    return {
      sessionId,
      profile: featureSequence.profile,
      verdict: this.verdict(candidates),
      candidates,
      elapsedMilliseconds: performance.now() - startedAt,
    }
  }

  private normalizeOptions(
    options: LoopAnalysisOptions,
    sourceDuration: number,
  ): LoopAnalysisOptions {
    const upperLimit = Math.max(0.5, sourceDuration - 0.35)
    const minimumDurationSeconds = clamp(options.minimumDurationSeconds, 0.4, upperLimit)
    const maximumDurationSeconds = clamp(
      options.maximumDurationSeconds,
      minimumDurationSeconds,
      upperLimit,
    )
    return {
      minimumDurationSeconds,
      maximumDurationSeconds,
      candidateCount: Math.round(clamp(options.candidateCount, 1, 12)),
      mode: options.mode,
    }
  }

  private verdict(candidates: readonly LoopCandidate[]): AnalysisVerdict {
    const strongest = candidates[0]
    if (strongest === undefined || strongest.qualityScore < 46) {
      return 'no-confident-loop'
    }
    if (strongest.qualityScore >= 80) {
      return 'excellent'
    }
    if (strongest.qualityScore >= 62) {
      return 'usable'
    }
    return 'experimental'
  }
}
