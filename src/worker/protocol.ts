import type {
  EngineProgress,
  LoopAnalysisOptions,
  LoopAnalysisResult,
  RenderedLoop,
} from '../domain/analysis'
import type {
  AudioAssetMetadata,
  AudioExportOptions,
  DecodedAudioAsset,
  ExportedAudioFile,
} from '../domain/audio'

interface WorkerRequestBase {
  readonly requestId: string
}

export type LoopWorkerRequest =
  | (WorkerRequestBase & { readonly type: 'ingest'; readonly asset: DecodedAudioAsset })
  | (WorkerRequestBase & {
      readonly type: 'analyze'
      readonly sessionId: string
      readonly options: LoopAnalysisOptions
    })
  | (WorkerRequestBase & {
      readonly type: 'render'
      readonly sessionId: string
      readonly candidateId: string
    })
  | (WorkerRequestBase & {
      readonly type: 'export'
      readonly sessionId: string
      readonly candidateId: string
      readonly options: AudioExportOptions
    })
  | (WorkerRequestBase & { readonly type: 'dispose'; readonly sessionId: string })

interface WorkerEventBase {
  readonly requestId: string
}

export type LoopWorkerEvent =
  | (WorkerEventBase & { readonly type: 'progress'; readonly progress: EngineProgress })
  | (WorkerEventBase & { readonly type: 'ingest-result'; readonly metadata: AudioAssetMetadata })
  | (WorkerEventBase & { readonly type: 'analysis-result'; readonly result: LoopAnalysisResult })
  | (WorkerEventBase & { readonly type: 'render-result'; readonly result: RenderedLoop })
  | (WorkerEventBase & { readonly type: 'export-result'; readonly result: ExportedAudioFile })
  | (WorkerEventBase & { readonly type: 'dispose-result' })
  | (WorkerEventBase & {
      readonly type: 'error'
      readonly message: string
      readonly stack?: string
    })
