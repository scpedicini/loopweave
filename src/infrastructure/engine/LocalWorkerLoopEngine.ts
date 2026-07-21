import type {
  LoopAnalysisOptions,
  LoopAnalysisResult,
  ProgressListener,
  RenderedLoop,
} from '../../domain/analysis'
import type {
  AudioAssetMetadata,
  AudioExportOptions,
  AudioFileSource,
  ExportedAudioFile,
} from '../../domain/audio'
import type { AudioDecoder, LoopEngine } from '../../domain/engine'
import type { LoopWorkerEvent, LoopWorkerRequest } from '../../worker/protocol'

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
  readonly onProgress: ProgressListener | undefined
}

export class LocalWorkerLoopEngine implements LoopEngine {
  private readonly decoder: AudioDecoder
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRequest>()
  private requestSequence = 0
  private closed = false

  constructor(decoder: AudioDecoder) {
    this.decoder = decoder
    this.worker = new Worker(new URL('../../worker/loop-engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'audio-loop-engine',
    })
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
  }

  async load(source: AudioFileSource, onProgress?: ProgressListener): Promise<AudioAssetMetadata> {
    this.ensureOpen()
    const asset = await this.decoder.decode(source, onProgress)
    onProgress?.({
      stage: 'preparing',
      fraction: 0.92,
      message: 'Moving analysis off the UI thread',
    })
    const requestId = this.nextRequestId()
    const request: LoopWorkerRequest = { type: 'ingest', requestId, asset }
    const transfer = asset.audio.channels.map((channel) => channel.buffer)
    return this.send<AudioAssetMetadata>(request, transfer, onProgress)
  }

  analyze(
    sessionId: string,
    options: LoopAnalysisOptions,
    onProgress?: ProgressListener,
  ): Promise<LoopAnalysisResult> {
    this.ensureOpen()
    const request: LoopWorkerRequest = {
      type: 'analyze',
      requestId: this.nextRequestId(),
      sessionId,
      options,
    }
    return this.send<LoopAnalysisResult>(request, [], onProgress)
  }

  render(sessionId: string, candidateId: string): Promise<RenderedLoop> {
    this.ensureOpen()
    const request: LoopWorkerRequest = {
      type: 'render',
      requestId: this.nextRequestId(),
      sessionId,
      candidateId,
    }
    return this.send<RenderedLoop>(request)
  }

  export(
    sessionId: string,
    candidateId: string,
    options: AudioExportOptions,
  ): Promise<ExportedAudioFile> {
    this.ensureOpen()
    const request: LoopWorkerRequest = {
      type: 'export',
      requestId: this.nextRequestId(),
      sessionId,
      candidateId,
      options,
    }
    return this.send<ExportedAudioFile>(request)
  }

  async disposeSession(sessionId: string): Promise<void> {
    if (this.closed) {
      return
    }
    const request: LoopWorkerRequest = {
      type: 'dispose',
      requestId: this.nextRequestId(),
      sessionId,
    }
    await this.send<void>(request)
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.terminate()
    for (const pending of this.pending.values()) {
      pending.reject(new Error('The local loop engine was closed.'))
    }
    this.pending.clear()
    await this.decoder.close()
  }

  private send<Result>(
    request: LoopWorkerRequest,
    transfer: readonly Transferable[] = [],
    onProgress?: ProgressListener,
  ): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (value) => resolve(value as Result),
        reject,
        onProgress,
      })
      this.worker.postMessage(request, transfer as Transferable[])
    })
  }

  private readonly handleMessage = (message: MessageEvent<LoopWorkerEvent>): void => {
    const event = message.data
    const pending = this.pending.get(event.requestId)
    if (pending === undefined) {
      return
    }
    if (event.type === 'progress') {
      pending.onProgress?.(event.progress)
      return
    }
    this.pending.delete(event.requestId)
    if (event.type === 'error') {
      const error = new Error(event.message)
      if (event.stack !== undefined) {
        error.stack = event.stack
      }
      pending.reject(error)
      return
    }

    switch (event.type) {
      case 'ingest-result':
        pending.resolve(event.metadata)
        break
      case 'analysis-result':
        pending.resolve(event.result)
        break
      case 'render-result':
        pending.resolve(event.result)
        break
      case 'export-result':
        pending.resolve(event.result)
        break
      case 'dispose-result':
        pending.resolve(undefined)
        break
    }
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'The local analysis worker stopped unexpectedly.')
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private nextRequestId(): string {
    this.requestSequence += 1
    return `request-${this.requestSequence}`
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('The local loop engine is closed.')
    }
  }
}
