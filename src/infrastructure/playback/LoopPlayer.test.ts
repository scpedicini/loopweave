import { describe, expect, it } from 'vitest'
import type { PlanarAudio } from '../../domain/audio'
import { createSeamAuditionAudio } from './LoopPlayer'

describe('createSeamAuditionAudio', () => {
  it('places the final five seconds immediately before the first five seconds', () => {
    const source: PlanarAudio = {
      sampleRate: 2,
      lengthSamples: 24,
      channels: [Float32Array.from({ length: 24 }, (_, index) => index)],
    }

    const audition = createSeamAuditionAudio(source)

    expect(audition.lengthSamples).toBe(20)
    expect(Array.from(audition.channels[0] ?? [])).toEqual([
      14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })

  it('accepts a loop exactly ten seconds long', () => {
    const sampleRate = 4
    const source: PlanarAudio = {
      sampleRate,
      lengthSamples: sampleRate * 10,
      channels: [new Float32Array(sampleRate * 10)],
    }

    expect(createSeamAuditionAudio(source).lengthSamples).toBe(source.lengthSamples)
  })

  it('adapts the listening window to loops shorter than ten seconds', () => {
    const source: PlanarAudio = {
      sampleRate: 10,
      lengthSamples: 9,
      channels: [Float32Array.from({ length: 9 }, (_, index) => index)],
    }

    const audition = createSeamAuditionAudio(source)

    expect(audition.lengthSamples).toBe(8)
    expect(Array.from(audition.channels[0] ?? [])).toEqual([5, 6, 7, 8, 0, 1, 2, 3])
  })
})
