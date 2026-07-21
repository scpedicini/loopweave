export interface AudioFileSource {
  readonly name: string
  readonly mediaType: string
  readonly sizeBytes: number
  readBytes(): Promise<ArrayBuffer>
}

export interface PlanarAudio {
  readonly sampleRate: number
  readonly lengthSamples: number
  readonly channels: readonly Float32Array[]
}

export interface MutablePlanarAudio {
  readonly sampleRate: number
  readonly lengthSamples: number
  readonly channels: Float32Array[]
}

export interface WaveformEnvelope {
  readonly minimum: Float32Array
  readonly maximum: Float32Array
}

export interface AudioAssetMetadata {
  readonly sessionId: string
  readonly fileName: string
  readonly mediaType: string
  readonly sourceSizeBytes: number
  readonly durationSeconds: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly lengthSamples: number
  readonly waveform: WaveformEnvelope
}

export interface DecodedAudioAsset {
  readonly sessionId: string
  readonly fileName: string
  readonly mediaType: string
  readonly sourceSizeBytes: number
  readonly audio: MutablePlanarAudio
}

export type WavEncoding = 'pcm16' | 'pcm24' | 'float32'

export interface AudioExportOptions {
  readonly encoding: WavEncoding
}

export interface ExportedAudioFile {
  readonly fileName: string
  readonly mediaType: 'audio/wav'
  readonly bytes: ArrayBuffer
}
