import { describe, expect, it } from 'vitest'
import { durationRangeForSource, resolveMaximumDurationSeconds } from './durationRange'

describe('durationRangeForSource', () => {
  it('uses source-aware defaults for the first file', () => {
    expect(durationRangeForSource(60)).toEqual({
      availableMaximumSeconds: 59.65,
      minimumSeconds: 2,
      maximumSeconds: 30,
    })
  })

  it('retains a chosen range when another file can support it', () => {
    expect(
      durationRangeForSource(60, {
        minimumSeconds: 8,
        maximumSeconds: 24,
      }),
    ).toEqual({
      availableMaximumSeconds: 59.65,
      minimumSeconds: 8,
      maximumSeconds: 24,
    })
  })

  it('clamps the chosen range when the next file is too short', () => {
    expect(
      durationRangeForSource(12, {
        minimumSeconds: 15,
        maximumSeconds: 24,
      }),
    ).toEqual({
      availableMaximumSeconds: 11.65,
      minimumSeconds: 11.6,
      maximumSeconds: 11.6,
    })
  })

  it('retains source maximum mode while clamping the minimum for a shorter file', () => {
    expect(
      durationRangeForSource(12, {
        minimumSeconds: 15,
        maximumSeconds: 0,
      }),
    ).toEqual({
      availableMaximumSeconds: 11.65,
      minimumSeconds: 11.6,
      maximumSeconds: 0,
    })
  })

  it('resolves zero to the current source maximum for analysis', () => {
    expect(resolveMaximumDurationSeconds(0, 42.65)).toBe(42.65)
    expect(resolveMaximumDurationSeconds(24, 42.65)).toBe(24)
  })
})
