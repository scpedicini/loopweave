import { formatError } from '../../core/dsp/math'
import type { ProgressListener } from '../../domain/analysis'
import type { AudioFileSource, DecodedAudioAsset } from '../../domain/audio'
import type { AudioDecoder } from '../../domain/engine'

export class BrowserAudioDecoder implements AudioDecoder {
  private context: AudioContext | undefined

  async decode(source: AudioFileSource, onProgress?: ProgressListener): Promise<DecodedAudioAsset> {
    try {
      onProgress?.({ stage: 'decoding', fraction: 0.02, message: 'Reading local file' })
      const bytes = await source.readBytes()
      onProgress?.({ stage: 'decoding', fraction: 0.2, message: 'Decoding audio locally' })
      const context = this.audioContext()
      const audioBuffer = await context.decodeAudioData(bytes)
      if (audioBuffer.numberOfChannels < 1 || audioBuffer.length < 1) {
        throw new Error('The selected file did not contain a readable audio stream.')
      }

      const channels: Float32Array[] = []
      for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
        channels.push(audioBuffer.getChannelData(channelIndex).slice())
      }
      onProgress?.({ stage: 'decoding', fraction: 0.9, message: 'Preparing sample buffers' })

      return {
        sessionId: this.sessionId(),
        fileName: source.name,
        mediaType: source.mediaType,
        sourceSizeBytes: source.sizeBytes,
        audio: {
          sampleRate: audioBuffer.sampleRate,
          lengthSamples: audioBuffer.length,
          channels,
        },
      }
    } catch (error) {
      throw new Error(
        `Unable to decode “${source.name}”. The browser may not support this codec. ${formatError(error)}`,
        { cause: error },
      )
    }
  }

  async close(): Promise<void> {
    if (this.context !== undefined && this.context.state !== 'closed') {
      await this.context.close()
    }
    this.context = undefined
  }

  private audioContext(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: 'playback' })
    return this.context
  }

  private sessionId(): string {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `audio-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}
