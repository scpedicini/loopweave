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
      searchStartSeconds: 2,
      searchEndSeconds: 5.5,
      candidateCount: 3,
      mode: 'balanced',
    })

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.length).toBeLessThanOrEqual(3)
    for (const item of result.candidates) {
      expect(item.startSeconds).toBeGreaterThanOrEqual(2)
      expect(item.endSeconds).toBeLessThanOrEqual(5.5)
      expect(item.endSample).toBeGreaterThan(item.startSample)
      expect(item.loopDurationSeconds).toBeGreaterThan(0.5)
      expect(item.qualityScore).toBeGreaterThan(0)
      expect(item.candidateId.startsWith('test-session:')).toBe(true)
    }
  })

  it('spreads comparable alternatives across long periodic source material', () => {
    const sampleRate = 12_000
    const durationSeconds = 20
    const samples = new Float32Array(sampleRate * durationSeconds)
    const period = new Float32Array(sampleRate * 0.2)
    for (let index = 0; index < period.length; index += 1) {
      period[index] = Math.sin((2 * Math.PI * index) / period.length) * 0.55
    }
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = period[index % period.length] ?? 0
    }
    const source: PlanarAudio = {
      sampleRate,
      lengthSamples: samples.length,
      channels: [samples],
    }

    const result = new LocalLoopAnalysisPipeline().analyze('diversity-session', source, {
      minimumDurationSeconds: 2,
      maximumDurationSeconds: 4,
      searchStartSeconds: 0,
      searchEndSeconds: durationSeconds,
      candidateCount: 5,
      mode: 'balanced',
    })
    const centers = result.candidates.map(
      (candidate) => (candidate.startSeconds + candidate.endSeconds) / 2,
    )

    expect(result.candidates).toHaveLength(5)
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(10)
  })
})
