import type { PlanarAudio, WavEncoding } from '../../domain/audio'
import { clamp } from '../dsp/math'

interface EncodingDescriptor {
  readonly audioFormat: 1 | 3
  readonly bitsPerSample: 16 | 24 | 32
  readonly bytesPerSample: 2 | 3 | 4
}

export class WavEncoder {
  encode(source: PlanarAudio, encoding: WavEncoding): ArrayBuffer {
    const descriptor = this.descriptor(encoding)
    const channelCount = source.channels.length
    if (channelCount < 1) {
      throw new Error('Cannot encode an audio buffer with no channels.')
    }
    const dataSize = source.lengthSamples * channelCount * descriptor.bytesPerSample
    if (dataSize > 0xffff_ffd0) {
      throw new Error('The rendered loop is too large for a standard RIFF/WAV file.')
    }

    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    this.writeAscii(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    this.writeAscii(view, 8, 'WAVE')
    this.writeAscii(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, descriptor.audioFormat, true)
    view.setUint16(22, channelCount, true)
    view.setUint32(24, source.sampleRate, true)
    view.setUint32(28, source.sampleRate * channelCount * descriptor.bytesPerSample, true)
    view.setUint16(32, channelCount * descriptor.bytesPerSample, true)
    view.setUint16(34, descriptor.bitsPerSample, true)
    this.writeAscii(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    let byteOffset = 44
    for (let sampleIndex = 0; sampleIndex < source.lengthSamples; sampleIndex += 1) {
      for (const channel of source.channels) {
        const sample = clamp(channel[sampleIndex] ?? 0, -1, 1)
        byteOffset = this.writeSample(view, byteOffset, sample, encoding)
      }
    }
    return buffer
  }

  private descriptor(encoding: WavEncoding): EncodingDescriptor {
    if (encoding === 'pcm16') {
      return { audioFormat: 1, bitsPerSample: 16, bytesPerSample: 2 }
    }
    if (encoding === 'pcm24') {
      return { audioFormat: 1, bitsPerSample: 24, bytesPerSample: 3 }
    }
    return { audioFormat: 3, bitsPerSample: 32, bytesPerSample: 4 }
  }

  private writeSample(
    view: DataView,
    offset: number,
    sample: number,
    encoding: WavEncoding,
  ): number {
    if (encoding === 'float32') {
      view.setFloat32(offset, sample, true)
      return offset + 4
    }
    if (encoding === 'pcm16') {
      const integer = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767)
      view.setInt16(offset, integer, true)
      return offset + 2
    }

    const integer = sample < 0 ? Math.round(sample * 8_388_608) : Math.round(sample * 8_388_607)
    view.setUint8(offset, integer & 0xff)
    view.setUint8(offset + 1, (integer >> 8) & 0xff)
    view.setUint8(offset + 2, (integer >> 16) & 0xff)
    return offset + 3
  }

  private writeAscii(view: DataView, offset: number, text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
}
