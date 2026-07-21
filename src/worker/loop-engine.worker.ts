/// <reference lib="webworker" />

import { LocalLoopAnalysisPipeline } from '../core/analysis/LocalLoopAnalysisPipeline'
import { LoopRenderer } from '../core/audio/LoopRenderer'
import { WavEncoder } from '../core/audio/WavEncoder'
import { WaveformSummarizer } from '../core/audio/WaveformSummarizer'
import { formatError } from '../core/dsp/math'
import type { LoopCandidate } from '../domain/analysis'
import type { PlanarAudio } from '../domain/audio'
import type { LoopWorkerEvent, LoopWorkerRequest } from './protocol'

interface WorkerSession {
  readonly fileName: string
  readonly mediaType: string
  readonly sourceSizeBytes: number
  readonly audio: PlanarAudio
  readonly candidates: Map<string, LoopCandidate>
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope
const sessions = new Map<string, WorkerSession>()
const pipeline = new LocalLoopAnalysisPipeline()
const loopRenderer = new LoopRenderer()
const waveformSummarizer = new WaveformSummarizer()
const wavEncoder = new WavEncoder()

workerScope.addEventListener('message', (message: MessageEvent<LoopWorkerRequest>) => {
  void handleRequest(message.data)
})

async function handleRequest(request: LoopWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'ingest': {
        postProgress(request.requestId, 'preparing', 0.96, 'Building waveform overview')
        const { asset } = request
        validateAudio(asset.audio)
        const waveform = waveformSummarizer.summarize(asset.audio)
        sessions.set(asset.sessionId, {
          fileName: asset.fileName,
          mediaType: asset.mediaType,
          sourceSizeBytes: asset.sourceSizeBytes,
          audio: asset.audio,
          candidates: new Map(),
        })
        const event: LoopWorkerEvent = {
          type: 'ingest-result',
          requestId: request.requestId,
          metadata: {
            sessionId: asset.sessionId,
            fileName: asset.fileName,
            mediaType: asset.mediaType,
            sourceSizeBytes: asset.sourceSizeBytes,
            durationSeconds: asset.audio.lengthSamples / asset.audio.sampleRate,
            sampleRate: asset.audio.sampleRate,
            numberOfChannels: asset.audio.channels.length,
            lengthSamples: asset.audio.lengthSamples,
            waveform,
          },
        }
        post(event, [waveform.minimum.buffer, waveform.maximum.buffer])
        break
      }
      case 'analyze': {
        const session = getSession(request.sessionId)
        const result = pipeline.analyze(
          request.sessionId,
          session.audio,
          request.options,
          (progress) => post({ type: 'progress', requestId: request.requestId, progress }),
        )
        session.candidates.clear()
        for (const candidate of result.candidates) {
          session.candidates.set(candidate.candidateId, candidate)
        }
        post({ type: 'analysis-result', requestId: request.requestId, result })
        break
      }
      case 'render': {
        const session = getSession(request.sessionId)
        const candidate = getCandidate(session, request.candidateId)
        postProgress(request.requestId, 'rendering', 0.2, 'Baking the circular transition')
        const audio = loopRenderer.render(session.audio, candidate)
        const event: LoopWorkerEvent = {
          type: 'render-result',
          requestId: request.requestId,
          result: { candidate, audio },
        }
        post(
          event,
          audio.channels.map((channel) => channel.buffer),
        )
        break
      }
      case 'export': {
        const session = getSession(request.sessionId)
        const candidate = getCandidate(session, request.candidateId)
        postProgress(request.requestId, 'exporting', 0.2, 'Rendering lossless loop')
        const audio = loopRenderer.render(session.audio, candidate)
        const bytes = wavEncoder.encode(audio, request.options.encoding)
        const baseName = session.fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
        post(
          {
            type: 'export-result',
            requestId: request.requestId,
            result: {
              fileName: `${baseName || 'audio'}-loop-${candidate.rank}.wav`,
              mediaType: 'audio/wav',
              bytes,
            },
          },
          [bytes],
        )
        break
      }
      case 'dispose': {
        sessions.delete(request.sessionId)
        post({ type: 'dispose-result', requestId: request.requestId })
        break
      }
    }
  } catch (error) {
    const baseEvent = {
      type: 'error' as const,
      requestId: request.requestId,
      message: formatError(error),
    }
    const event: LoopWorkerEvent =
      error instanceof Error && error.stack !== undefined
        ? { ...baseEvent, stack: error.stack }
        : baseEvent
    post(event)
  }
}

function validateAudio(audio: PlanarAudio): void {
  if (audio.sampleRate <= 0 || audio.lengthSamples <= 0 || audio.channels.length === 0) {
    throw new Error('The decoded audio buffer is empty or invalid.')
  }
  for (const channel of audio.channels) {
    if (channel.length !== audio.lengthSamples) {
      throw new Error('Decoded audio channels do not have matching lengths.')
    }
  }
}

function getSession(sessionId: string): WorkerSession {
  const session = sessions.get(sessionId)
  if (session === undefined) {
    throw new Error('The audio session is no longer available. Load the file again.')
  }
  return session
}

function getCandidate(session: WorkerSession, candidateId: string): LoopCandidate {
  const candidate = session.candidates.get(candidateId)
  if (candidate === undefined) {
    throw new Error('The requested loop candidate is no longer available. Analyze the file again.')
  }
  return candidate
}

function postProgress(
  requestId: string,
  stage: 'preparing' | 'rendering' | 'exporting',
  fraction: number,
  message: string,
): void {
  post({ type: 'progress', requestId, progress: { stage, fraction, message } })
}

function post(event: LoopWorkerEvent, transfer: readonly Transferable[] = []): void {
  workerScope.postMessage(event, transfer as Transferable[])
}
