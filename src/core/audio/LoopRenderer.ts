import type { FadeCurve, LoopCandidate, SeamRenderer } from '../../domain/analysis'
import type { MutablePlanarAudio, PlanarAudio } from '../../domain/audio'
import { clamp } from '../dsp/math'

export interface FadeWeights {
  readonly outgoing: number
  readonly incoming: number
}

export class LoopRenderer {
  render(source: PlanarAudio, candidate: LoopCandidate): MutablePlanarAudio {
    const start = clamp(Math.round(candidate.startSample), 0, source.lengthSamples - 1)
    const end = clamp(Math.round(candidate.endSample), start + 1, source.lengthSamples)
    const renderer = candidate.renderer
    if (renderer.kind === 'hard-cut') {
      return this.renderHardCut(source, start, end, renderer)
    }
    return this.renderCrossfade(source, start, end, renderer)
  }

  weights(curve: FadeCurve, amount: number, correlation: number): FadeWeights {
    const position = clamp(amount, 0, 1)
    if (curve === 'linear') {
      return { outgoing: 1 - position, incoming: position }
    }
    if (curve === 'equal-power') {
      return {
        outgoing: Math.cos((position * Math.PI) / 2),
        incoming: Math.sin((position * Math.PI) / 2),
      }
    }

    const outgoing = 1 - position
    const incoming = position
    const safeCorrelation = clamp(correlation, -0.94, 0.99)
    const normalizer = Math.sqrt(
      Math.max(
        0.04,
        outgoing * outgoing + incoming * incoming + 2 * safeCorrelation * outgoing * incoming,
      ),
    )
    return {
      outgoing: outgoing / normalizer,
      incoming: incoming / normalizer,
    }
  }

  private renderHardCut(
    source: PlanarAudio,
    start: number,
    end: number,
    renderer: SeamRenderer,
  ): MutablePlanarAudio {
    const channels = source.channels.map((channel) => {
      const output = channel.slice(start, end)
      this.applyGain(output, renderer.outputGain)
      return output
    })
    return {
      sampleRate: source.sampleRate,
      lengthSamples: end - start,
      channels,
    }
  }

  private renderCrossfade(
    source: PlanarAudio,
    start: number,
    end: number,
    renderer: Extract<SeamRenderer, { kind: 'crossfade' }>,
  ): MutablePlanarAudio {
    const sourceLength = end - start
    const fadeSamples = clamp(renderer.fadeSamples, 1, Math.max(1, Math.floor(sourceLength / 3)))
    const outputLength = sourceLength - fadeSamples
    const channels = source.channels.map((channel) => {
      const output = new Float32Array(outputLength)
      const denominator = Math.max(1, fadeSamples - 1)
      for (let index = 0; index < fadeSamples; index += 1) {
        const weights = this.weights(renderer.curve, index / denominator, renderer.correlation)
        const tail = channel[end - fadeSamples + index] ?? 0
        const head = channel[start + index] ?? 0
        output[index] = tail * weights.outgoing + head * weights.incoming
      }

      const middleStart = start + fadeSamples
      const middleEnd = end - fadeSamples
      if (middleEnd > middleStart) {
        output.set(channel.subarray(middleStart, middleEnd), fadeSamples)
      }
      this.applyGain(output, renderer.outputGain)
      return output
    })

    return {
      sampleRate: source.sampleRate,
      lengthSamples: outputLength,
      channels,
    }
  }

  private applyGain(samples: Float32Array, gain: number): void {
    if (Math.abs(gain - 1) < 1e-8) {
      return
    }
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (samples[index] ?? 0) * gain
    }
  }
}
