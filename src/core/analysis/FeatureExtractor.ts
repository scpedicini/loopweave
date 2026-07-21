import type { ContentProfile, ContentRegime } from '../../domain/analysis'
import type { PlanarAudio } from '../../domain/audio'
import { AnalysisResampler } from '../audio/AnalysisResampler'
import { FastFourierTransform } from '../dsp/FastFourierTransform'
import { average, clamp, median, percentile, vectorDistance } from '../dsp/math'

export interface FeatureFrame {
  readonly timeSeconds: number
  readonly vector: Float32Array
  readonly novelty: number
  readonly flux: number
  readonly flatness: number
  readonly rms: number
}

export interface FeatureSequence {
  readonly frames: readonly FeatureFrame[]
  readonly hopSeconds: number
  readonly profile: ContentProfile
}

interface RawFeatureFrame {
  readonly timeSeconds: number
  readonly vector: Float32Array
  readonly flux: number
  readonly flatness: number
  readonly rms: number
}

interface MelBand {
  readonly startBin: number
  readonly centerBin: number
  readonly endBin: number
}

export type FeatureProgress = (fraction: number) => void

export class FeatureExtractor {
  private readonly analysisSampleRate = 12_000
  private readonly frameSize = 2_048
  private readonly hopSeconds = 0.2
  private readonly melBandCount = 20
  private readonly resampler = new AnalysisResampler()

  extract(source: PlanarAudio, onProgress?: FeatureProgress): FeatureSequence {
    const mono = this.resampler.downmixAndResample(source, this.analysisSampleRate)
    const fft = new FastFourierTransform(this.frameSize)
    const hopSamples = Math.max(1, Math.round(this.hopSeconds * this.analysisSampleRate))
    const melBands = this.createMelBands()
    const rawFrames: RawFeatureFrame[] = []
    let previousMagnitude: Float32Array | undefined
    const frameCount = Math.max(1, Math.ceil(mono.length / hopSamples))

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const offset = frameIndex * hopSamples
      const magnitude = fft.magnitude(mono, offset)
      const timeSeconds = Math.min(
        source.lengthSamples / source.sampleRate,
        (offset + this.frameSize / 2) / this.analysisSampleRate,
      )
      const rms = this.calculateRms(mono, offset, this.frameSize)
      const flatness = this.calculateFlatness(magnitude)
      const centroid = this.calculateCentroid(magnitude)
      const zeroCrossingRate = this.calculateZeroCrossingRate(mono, offset, this.frameSize)
      const flux = this.calculateFlux(magnitude, previousMagnitude)
      const vector = new Float32Array(this.melBandCount + 5)

      for (let bandIndex = 0; bandIndex < melBands.length; bandIndex += 1) {
        vector[bandIndex] = Math.log(this.calculateMelEnergy(magnitude, melBands[bandIndex]))
      }
      vector[this.melBandCount] = Math.log(rms + 1e-8)
      vector[this.melBandCount + 1] = flatness
      vector[this.melBandCount + 2] = centroid
      vector[this.melBandCount + 3] = zeroCrossingRate
      vector[this.melBandCount + 4] = flux

      rawFrames.push({ timeSeconds, vector, flux, flatness, rms })
      previousMagnitude = magnitude

      if (frameIndex % 20 === 0) {
        onProgress?.(frameIndex / frameCount)
      }
    }

    const normalizedVectors = this.normalize(rawFrames.map((frame) => frame.vector))
    const frames: FeatureFrame[] = rawFrames.map((frame, index) => {
      const vector = normalizedVectors[index] ?? new Float32Array()
      const previous = normalizedVectors[index - 1]
      const novelty = previous === undefined ? 0 : vectorDistance(vector, previous)
      return {
        timeSeconds: frame.timeSeconds,
        vector,
        novelty,
        flux: frame.flux,
        flatness: frame.flatness,
        rms: frame.rms,
      }
    })

    onProgress?.(1)
    return {
      frames,
      hopSeconds: this.hopSeconds,
      profile: this.createContentProfile(frames),
    }
  }

  private createMelBands(): readonly MelBand[] {
    const minimumFrequency = 40
    const maximumFrequency = this.analysisSampleRate / 2
    const minimumMel = this.hertzToMel(minimumFrequency)
    const maximumMel = this.hertzToMel(maximumFrequency)
    const points: number[] = []

    for (let index = 0; index < this.melBandCount + 2; index += 1) {
      const mel = minimumMel + ((maximumMel - minimumMel) * index) / (this.melBandCount + 1)
      const hertz = this.melToHertz(mel)
      points.push(
        clamp(
          Math.floor(((this.frameSize + 1) * hertz) / this.analysisSampleRate),
          0,
          this.frameSize / 2,
        ),
      )
    }

    const bands: MelBand[] = []
    for (let index = 0; index < this.melBandCount; index += 1) {
      bands.push({
        startBin: points[index] ?? 0,
        centerBin: points[index + 1] ?? 0,
        endBin: points[index + 2] ?? this.frameSize / 2,
      })
    }
    return bands
  }

  private calculateMelEnergy(magnitude: Float32Array, band: MelBand | undefined): number {
    if (band === undefined) {
      return 1e-10
    }

    let energy = 0
    const risingWidth = Math.max(1, band.centerBin - band.startBin)
    const fallingWidth = Math.max(1, band.endBin - band.centerBin)
    for (let bin = band.startBin; bin < band.centerBin; bin += 1) {
      const weight = (bin - band.startBin) / risingWidth
      const value = magnitude[bin] ?? 0
      energy += value * value * weight
    }
    for (let bin = band.centerBin; bin <= band.endBin; bin += 1) {
      const weight = (band.endBin - bin) / fallingWidth
      const value = magnitude[bin] ?? 0
      energy += value * value * weight
    }
    return energy + 1e-10
  }

  private calculateRms(signal: Float32Array, offset: number, length: number): number {
    let sum = 0
    let sampleCount = 0
    const end = Math.min(signal.length, offset + length)
    for (let index = offset; index < end; index += 1) {
      const sample = signal[index] ?? 0
      sum += sample * sample
      sampleCount += 1
    }
    return Math.sqrt(sum / Math.max(1, sampleCount))
  }

  private calculateFlatness(magnitude: Float32Array): number {
    let logTotal = 0
    let linearTotal = 0
    const startBin = 2
    for (let index = startBin; index < magnitude.length; index += 1) {
      const value = (magnitude[index] ?? 0) + 1e-10
      logTotal += Math.log(value)
      linearTotal += value
    }
    const count = Math.max(1, magnitude.length - startBin)
    return clamp(Math.exp(logTotal / count) / (linearTotal / count + 1e-10), 0, 1)
  }

  private calculateCentroid(magnitude: Float32Array): number {
    let weighted = 0
    let total = 0
    for (let index = 0; index < magnitude.length; index += 1) {
      const value = magnitude[index] ?? 0
      weighted += index * value
      total += value
    }
    return total > 0 ? weighted / total / Math.max(1, magnitude.length - 1) : 0
  }

  private calculateZeroCrossingRate(signal: Float32Array, offset: number, length: number): number {
    let crossings = 0
    const end = Math.min(signal.length, offset + length)
    for (let index = offset + 1; index < end; index += 1) {
      const previous = signal[index - 1] ?? 0
      const current = signal[index] ?? 0
      if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) {
        crossings += 1
      }
    }
    return crossings / Math.max(1, end - offset - 1)
  }

  private calculateFlux(magnitude: Float32Array, previous: Float32Array | undefined): number {
    if (previous === undefined) {
      return 0
    }

    let positiveDifference = 0
    let total = 0
    for (let index = 0; index < magnitude.length; index += 1) {
      const current = magnitude[index] ?? 0
      positiveDifference += Math.max(0, current - (previous[index] ?? 0))
      total += current
    }
    return positiveDifference / (total + 1e-10)
  }

  private normalize(vectors: readonly Float32Array[]): readonly Float32Array[] {
    const dimension = vectors[0]?.length ?? 0
    const means = new Float64Array(dimension)
    const deviations = new Float64Array(dimension)

    for (const vector of vectors) {
      for (let index = 0; index < dimension; index += 1) {
        means[index] = (means[index] ?? 0) + (vector[index] ?? 0)
      }
    }
    for (let index = 0; index < dimension; index += 1) {
      means[index] = (means[index] ?? 0) / Math.max(1, vectors.length)
    }
    for (const vector of vectors) {
      for (let index = 0; index < dimension; index += 1) {
        const difference = (vector[index] ?? 0) - (means[index] ?? 0)
        deviations[index] = (deviations[index] ?? 0) + difference * difference
      }
    }
    for (let index = 0; index < dimension; index += 1) {
      deviations[index] = Math.sqrt(
        (deviations[index] ?? 0) / Math.max(1, vectors.length - 1) + 1e-8,
      )
    }

    return vectors.map((vector) => {
      const normalized = new Float32Array(dimension)
      for (let index = 0; index < dimension; index += 1) {
        normalized[index] = clamp(
          ((vector[index] ?? 0) - (means[index] ?? 0)) / (deviations[index] ?? 1),
          -5,
          5,
        )
      }
      return normalized
    })
  }

  private createContentProfile(frames: readonly FeatureFrame[]): ContentProfile {
    const flatnessValues = frames.map((frame) => frame.flatness)
    const noveltyValues = frames.slice(1).map((frame) => frame.novelty)
    const fluxValues = frames.map((frame) => frame.flux)
    const medianFlatness = median(flatnessValues)
    const textureConfidence = clamp(Math.sqrt(medianFlatness) * 1.4, 0, 1)
    const tonality = clamp(1 - Math.sqrt(medianFlatness) * 1.2, 0, 1)
    const stationarity = clamp(Math.exp(-average(noveltyValues) * 1.25), 0, 1)
    const fluxThreshold = Math.max(percentile(fluxValues, 0.75), median(fluxValues) * 1.8)
    const transientDensity =
      frames.length === 0
        ? 0
        : clamp(
            fluxValues.filter((value) => value > fluxThreshold).length / frames.length / 0.25,
            0,
            1,
          )
    const rhythmicity = this.calculateRhythmicity(fluxValues)
    const regime = this.chooseRegime({
      stationarity,
      tonality,
      rhythmicity,
      transientDensity,
      textureConfidence,
    })

    return {
      regime,
      stationarity,
      tonality,
      rhythmicity,
      transientDensity,
      textureConfidence,
    }
  }

  private calculateRhythmicity(flux: readonly number[]): number {
    if (flux.length < 8) {
      return 0
    }
    const fluxMean = average(flux)
    let energy = 0
    for (const value of flux) {
      const centered = value - fluxMean
      energy += centered * centered
    }
    if (energy < 1e-10) {
      return 0
    }

    const minimumLag = Math.max(2, Math.round(0.3 / this.hopSeconds))
    const maximumLag = Math.min(flux.length - 2, Math.round(2 / this.hopSeconds))
    let strongest = 0
    for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
      let correlation = 0
      for (let index = lag; index < flux.length; index += 1) {
        correlation += ((flux[index] ?? 0) - fluxMean) * ((flux[index - lag] ?? 0) - fluxMean)
      }
      strongest = Math.max(strongest, correlation / energy)
    }
    return clamp(strongest * 1.8, 0, 1)
  }

  private chooseRegime(profile: Omit<ContentProfile, 'regime'>): ContentRegime {
    if (profile.stationarity < 0.35) {
      return 'nonstationary'
    }
    if (profile.rhythmicity > 0.58 && profile.transientDensity > 0.3) {
      return 'rhythmic'
    }
    if (profile.tonality > 0.68 && profile.textureConfidence < 0.5) {
      return 'tonal'
    }
    if (profile.textureConfidence > 0.55 && profile.stationarity > 0.48) {
      return 'texture'
    }
    return 'mixed'
  }

  private hertzToMel(hertz: number): number {
    return 2_595 * Math.log10(1 + hertz / 700)
  }

  private melToHertz(mel: number): number {
    return 700 * (10 ** (mel / 2_595) - 1)
  }
}
