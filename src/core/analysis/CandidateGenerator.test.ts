import { describe, expect, it } from 'vitest'
import { CandidateGenerator } from './CandidateGenerator'
import type { FeatureFrame, FeatureSequence } from './FeatureExtractor'

describe('CandidateGenerator', () => {
  it('keeps refinement candidates from across a long search range when global scores tie', () => {
    const hopSeconds = 0.2
    const frames: FeatureFrame[] = Array.from({ length: 301 }, (_, index) => ({
      timeSeconds: index * hopSeconds,
      vector: new Float32Array([0]),
      novelty: 0,
      flux: 0,
      flatness: 1,
      rms: 0.1,
    }))
    const sequence: FeatureSequence = {
      frames,
      hopSeconds,
      profile: {
        regime: 'texture',
        stationarity: 1,
        tonality: 0,
        rhythmicity: 0,
        transientDensity: 0,
        textureConfidence: 1,
      },
    }

    const candidates = new CandidateGenerator().generate(sequence, {
      minimumDurationSeconds: 2,
      maximumDurationSeconds: 4,
      searchStartSeconds: 0,
      searchEndSeconds: 60,
      candidateCount: 5,
      mode: 'balanced',
    })
    const centers = candidates.map(
      (candidate) => (candidate.startSeconds + candidate.endSeconds) / 2,
    )

    expect(candidates).toHaveLength(40)
    expect(Math.min(...centers)).toBeLessThan(10)
    expect(Math.max(...centers)).toBeGreaterThan(50)
  })
})
