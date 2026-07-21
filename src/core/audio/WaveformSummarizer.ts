import type { PlanarAudio, WaveformEnvelope } from '../../domain/audio'

export class WaveformSummarizer {
  summarize(source: PlanarAudio, binCount = 1_200): WaveformEnvelope {
    const bins = Math.max(1, Math.min(binCount, source.lengthSamples))
    const minimum = new Float32Array(bins)
    const maximum = new Float32Array(bins)
    const channelGain = 1 / Math.max(1, source.channels.length)

    for (let bin = 0; bin < bins; bin += 1) {
      const start = Math.floor((bin * source.lengthSamples) / bins)
      const end = Math.max(start + 1, Math.floor(((bin + 1) * source.lengthSamples) / bins))
      let low = 1
      let high = -1
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        let sample = 0
        for (const channel of source.channels) {
          sample += (channel[sampleIndex] ?? 0) * channelGain
        }
        low = Math.min(low, sample)
        high = Math.max(high, sample)
      }
      minimum[bin] = low
      maximum[bin] = high
    }

    return { minimum, maximum }
  }
}
