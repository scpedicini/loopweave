import { describe, expect, it } from 'vitest'
import type { LoopCandidate } from '../../domain/analysis'
import type { PlanarAudio } from '../../domain/audio'
import { LoopRenderer } from './LoopRenderer'

function candidate(renderer: LoopCandidate['renderer']): LoopCandidate {
  return {
    candidateId: 'test-candidate',
    rank: 1,
    label: 'Test',
    startSample: 100,
    endSample: 900,
    startSeconds: 0.1,
    endSeconds: 0.9,
    sourceDurationSeconds: 0.8,
    loopDurationSeconds: renderer.kind === 'crossfade' ? 0.7 : 0.8,
    qualityScore: 90,
    confidence: 'high',
    renderer,
    scores: {
      recurrence: 0,
      stationarity: 0,
      rareEvent: 0,
      trajectory: 0,
      seam: 0,
      modification: 0,
      total: 0,
    },
    diagnostics: [],
  }
}

describe('LoopRenderer', () => {
  it('overlaps the tail and head while moving the physical file boundary into continuous audio', () => {
    const samples = new Float32Array(1_000)
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index / 1_000
    }
    const source: PlanarAudio = {
      sampleRate: 1_000,
      lengthSamples: samples.length,
      channels: [samples],
    }
    const rendered = new LoopRenderer().render(
      source,
      candidate({
        kind: 'crossfade',
        fadeSamples: 100,
        fadeSeconds: 0.1,
        curve: 'linear',
        correlation: 1,
        outputGain: 1,
      }),
    )

    expect(rendered.lengthSamples).toBe(700)
    expect(rendered.channels[0]?.[0]).toBeCloseTo(0.8, 5)
    expect(rendered.channels[0]?.[699]).toBeCloseTo(0.799, 5)
    expect(
      Math.abs((rendered.channels[0]?.[0] ?? 0) - (rendered.channels[0]?.[699] ?? 0)),
    ).toBeLessThan(0.002)
  })

  it('preserves the requested interval for a hard cut', () => {
    const samples = Float32Array.from({ length: 1_000 }, (_, index) => Math.sin(index / 20))
    const source: PlanarAudio = {
      sampleRate: 1_000,
      lengthSamples: samples.length,
      channels: [samples],
    }
    const rendered = new LoopRenderer().render(
      source,
      candidate({ kind: 'hard-cut', outputGain: 1 }),
    )

    expect(rendered.lengthSamples).toBe(800)
    expect(rendered.channels[0]?.[0]).toBe(samples[100])
    expect(rendered.channels[0]?.[799]).toBe(samples[899])
  })
})
