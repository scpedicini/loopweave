import { describe, expect, it } from 'vitest'
import { FastFourierTransform } from './FastFourierTransform'

describe('FastFourierTransform', () => {
  it('locates the dominant bin of a bin-centered sinusoid', () => {
    const size = 1_024
    const targetBin = 37
    const signal = new Float32Array(size)
    for (let index = 0; index < size; index += 1) {
      signal[index] = Math.sin((2 * Math.PI * targetBin * index) / size)
    }

    const magnitude = new FastFourierTransform(size).magnitude(signal)
    let strongestBin = 0
    for (let index = 1; index < magnitude.length; index += 1) {
      if ((magnitude[index] ?? 0) > (magnitude[strongestBin] ?? 0)) {
        strongestBin = index
      }
    }

    expect(strongestBin).toBe(targetBin)
    expect(magnitude[targetBin]).toBeGreaterThan(200)
  })
})
