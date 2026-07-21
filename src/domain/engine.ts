import type {
  LoopAnalysisOptions,
  LoopAnalysisResult,
  ProgressListener,
  RenderedLoop,
} from './analysis'
import type {
  AudioAssetMetadata,
  AudioExportOptions,
  AudioFileSource,
  ExportedAudioFile,
} from './audio'

export interface LoopEngine {
  load(source: AudioFileSource, onProgress?: ProgressListener): Promise<AudioAssetMetadata>
  analyze(
    sessionId: string,
    options: LoopAnalysisOptions,
    onProgress?: ProgressListener,
  ): Promise<LoopAnalysisResult>
  render(sessionId: string, candidateId: string): Promise<RenderedLoop>
  export(
    sessionId: string,
    candidateId: string,
    options: AudioExportOptions,
  ): Promise<ExportedAudioFile>
  disposeSession(sessionId: string): Promise<void>
  close(): Promise<void>
}

export interface AudioDecoder {
  decode(
    source: AudioFileSource,
    onProgress?: ProgressListener,
  ): Promise<import('./audio').DecodedAudioAsset>
  close(): Promise<void>
}
