import { describe, expect, it } from 'vitest'
import type { ContentProfile, LoopAnalysisOptions } from '../../domain/analysis'
import type { PlanarAudio } from '../../domain/audio'
import type { CoarseCandidate } from './CandidateGenerator'
import { SeamOptimizer } from './SeamOptimizer'

const sampleRate = 200
const source: PlanarAudio = {
  sampleRate,
  lengthSamples: sampleRate * 20,
  channels: [new Float32Array(sampleRate * 20)],
}
const profile: ContentProfile = {
  regime: 'mixed',
  stationarity: 1,
  tonality: 0.5,
  rhythmicity: 0,
  transientDensity: 0,
  textureConfidence: 0.5,
}

function options(candidateCount: number): LoopAnalysisOptions {
  return {
    minimumDurationSeconds: 1,
    maximumDurationSeconds: 4,
    searchStartSeconds: 0,
    searchEndSeconds: 20,
    candidateCount,
    mode: 'balanced',
  }
}

function coarse(startSeconds: number, endSeconds: number, coarseCost: number): CoarseCandidate {
  return {
    startFrame: Math.round(startSeconds / 0.2),
    endFrame: Math.round(endSeconds / 0.2),
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    recurrenceCost: coarseCost,
    stationarityCost: 0,
    rareEventCost: 0,
    trajectoryCost: 0,
    coarseCost,
  }
}

describe('SeamOptimizer candidate selection', () => {
  it('promotes temporal diversity among candidates with comparable final quality', () => {
    const candidates = [
      coarse(1, 4, 0.1),
      coarse(1.2, 4.2, 0.101),
      coarse(0.8, 3.8, 0.102),
      coarse(8, 11, 0.11),
      coarse(15, 18, 0.115),
    ]

    const result = new SeamOptimizer().optimize(
      'diverse-session',
      source,
      candidates,
      profile,
      options(3),
    )

    expect(result.map((candidate) => candidate.startSeconds)).toEqual([1, 8, 15])
    expect(result[0]?.qualityScore).toBeGreaterThanOrEqual(result[1]?.qualityScore ?? 0)
    expect(result[1]?.qualityScore).toBeGreaterThanOrEqual(result[2]?.qualityScore ?? 0)
  })

  it('keeps a stronger nearby alternative instead of forcing a large quality sacrifice', () => {
    const candidates = [coarse(1, 4, 0.1), coarse(1.2, 4.2, 0.11), coarse(15, 18, 1)]

    const result = new SeamOptimizer().optimize(
      'quality-session',
      source,
      candidates,
      profile,
      options(2),
    )

    expect(result.map((candidate) => candidate.startSeconds)).toEqual([1, 1.2])
    expect(result[1]?.qualityScore).toBeGreaterThan(90)
  })
})
