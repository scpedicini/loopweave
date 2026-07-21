import type { MutablePlanarAudio } from './audio'

export type AnalysisMode = 'balanced' | 'cleanest' | 'longest'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type AnalysisVerdict = 'excellent' | 'usable' | 'experimental' | 'no-confident-loop'
export type ContentRegime = 'texture' | 'tonal' | 'rhythmic' | 'mixed' | 'nonstationary'
export type FadeCurve = 'linear' | 'equal-power' | 'correlation-matched'

export interface LoopAnalysisOptions {
  readonly minimumDurationSeconds: number
  readonly maximumDurationSeconds: number
  readonly candidateCount: number
  readonly mode: AnalysisMode
}

export interface ContentProfile {
  readonly regime: ContentRegime
  readonly stationarity: number
  readonly tonality: number
  readonly rhythmicity: number
  readonly transientDensity: number
  readonly textureConfidence: number
}

export interface HardCutRenderer {
  readonly kind: 'hard-cut'
  readonly outputGain: number
}

export interface CrossfadeRenderer {
  readonly kind: 'crossfade'
  readonly fadeSamples: number
  readonly fadeSeconds: number
  readonly curve: FadeCurve
  readonly correlation: number
  readonly outputGain: number
}

export type SeamRenderer = HardCutRenderer | CrossfadeRenderer

export interface CandidateScoreBreakdown {
  readonly recurrence: number
  readonly stationarity: number
  readonly rareEvent: number
  readonly trajectory: number
  readonly seam: number
  readonly modification: number
  readonly total: number
}

export type DiagnosticTone = 'positive' | 'neutral' | 'warning'

export interface CandidateDiagnostic {
  readonly code: string
  readonly tone: DiagnosticTone
  readonly message: string
}

export interface LoopCandidate {
  readonly candidateId: string
  readonly rank: number
  readonly label: string
  readonly startSample: number
  readonly endSample: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly sourceDurationSeconds: number
  readonly loopDurationSeconds: number
  readonly qualityScore: number
  readonly confidence: ConfidenceLevel
  readonly renderer: SeamRenderer
  readonly scores: CandidateScoreBreakdown
  readonly diagnostics: readonly CandidateDiagnostic[]
}

export interface LoopAnalysisResult {
  readonly sessionId: string
  readonly profile: ContentProfile
  readonly verdict: AnalysisVerdict
  readonly candidates: readonly LoopCandidate[]
  readonly elapsedMilliseconds: number
}

export interface RenderedLoop {
  readonly candidate: LoopCandidate
  readonly audio: MutablePlanarAudio
}

export type EngineStage =
  | 'decoding'
  | 'preparing'
  | 'features'
  | 'candidates'
  | 'refining'
  | 'rendering'
  | 'exporting'

export interface EngineProgress {
  readonly stage: EngineStage
  readonly fraction: number
  readonly message: string
}

export type ProgressListener = (progress: EngineProgress) => void
