import type { PlanarAudio } from '../../domain/audio'

export class AnalysisResampler {
  downmixAndResample(source: PlanarAudio, targetSampleRate: number): Float32Array {
    if (source.channels.length === 0 || source.lengthSamples === 0) {
      return new Float32Array()
    }

    const targetLength = Math.max(
      1,
      Math.round((source.lengthSamples * targetSampleRate) / source.sampleRate),
    )
    const output = new Float32Array(targetLength)
    const sourceStep = source.sampleRate / targetSampleRate
    const channelGain = 1 / source.channels.length

    for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
      const sourcePosition = targetIndex * sourceStep
      const lowerIndex = Math.min(source.lengthSamples - 1, Math.floor(sourcePosition))
      const upperIndex = Math.min(source.lengthSamples - 1, lowerIndex + 1)
      const fraction = sourcePosition - lowerIndex
      let mixedSample = 0

      for (const channel of source.channels) {
        const lower = channel[lowerIndex] ?? 0
        const upper = channel[upperIndex] ?? lower
        mixedSample += (lower + (upper - lower) * fraction) * channelGain
      }
      output[targetIndex] = mixedSample
    }

    return output
  }
}
