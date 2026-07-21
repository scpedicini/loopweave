import { describe, expect, it } from 'vitest'
import type { PlanarAudio } from '../../domain/audio'
import { LocalLoopAnalysisPipeline } from './LocalLoopAnalysisPipeline'

describe('LocalLoopAnalysisPipeline', () => {
  it('returns bounded, renderable candidates for periodic source material', () => {
    const sampleRate = 12_000
    const durationSeconds = 7
    const samples = new Float32Array(sampleRate * durationSeconds)
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate
      samples[index] =
        Math.sin(2 * Math.PI * 220 * time) * 0.55 + Math.sin(2 * Math.PI * 440 * time) * 0.16
    }
    const source: PlanarAudio = {
      sampleRate,
      lengthSamples: samples.length,
      channels: [samples],
    }

    const result = new LocalLoopAnalysisPipeline().analyze('test-session', source, {
      minimumDurationSeconds: 1,
      maximumDurationSeconds: 3,
      candidateCount: 3,
      qualityBias: 0.8,
      mode: 'balanced',
    })

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.length).toBeLessThanOrEqual(3)
    for (const item of result.candidates) {
      expect(item.startSample).toBeGreaterThanOrEqual(0)
      expect(item.endSample).toBeGreaterThan(item.startSample)
      expect(item.loopDurationSeconds).toBeGreaterThan(0.5)
      expect(item.qualityScore).toBeGreaterThan(0)
      expect(item.candidateId.startsWith('test-session:')).toBe(true)
    }
  })
})
