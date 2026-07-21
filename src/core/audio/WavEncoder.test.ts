import { describe, expect, it } from 'vitest'
import type { PlanarAudio } from '../../domain/audio'
import { WavEncoder } from './WavEncoder'

describe('WavEncoder', () => {
  it('writes a valid interleaved 24-bit PCM WAV header', () => {
    const source: PlanarAudio = {
      sampleRate: 48_000,
      lengthSamples: 4,
      channels: [new Float32Array([0, 0.25, -0.25, 1]), new Float32Array([0, -0.5, 0.5, -1])],
    }
    const bytes = new WavEncoder().encode(source, 'pcm24')
    const view = new DataView(bytes)
    const text = (offset: number, length: number): string =>
      String.fromCharCode(...new Uint8Array(bytes, offset, length))

    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48_000)
    expect(view.getUint16(34, true)).toBe(24)
    expect(view.getUint32(40, true)).toBe(24)
    expect(bytes.byteLength).toBe(68)
  })
})
