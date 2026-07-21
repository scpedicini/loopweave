import type { LoopAnalysisOptions } from '../../domain/analysis'
import { clamp, median, vectorDistance } from '../dsp/math'
import type { FeatureFrame, FeatureSequence } from './FeatureExtractor'

export interface CoarseCandidate {
  readonly startFrame: number
  readonly endFrame: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly recurrenceCost: number
  readonly stationarityCost: number
  readonly rareEventCost: number
  readonly trajectoryCost: number
  readonly coarseCost: number
}

const BALANCED_QUALITY_BIAS = 0.75

export type CandidateProgress = (fraction: number) => void

class RangeMaximumTree {
  private readonly leafCount: number
  private readonly values: Float32Array

  constructor(source: readonly number[]) {
    let leafCount = 1
    while (leafCount < source.length) {
      leafCount *= 2
    }
    this.leafCount = leafCount
    this.values = new Float32Array(leafCount * 2)
    for (let index = 0; index < source.length; index += 1) {
      this.values[leafCount + index] = source[index] ?? 0
    }
    for (let index = leafCount - 1; index > 0; index -= 1) {
      this.values[index] = Math.max(this.values[index * 2] ?? 0, this.values[index * 2 + 1] ?? 0)
    }
  }

  query(startInclusive: number, endExclusive: number): number {
    let left = clamp(startInclusive, 0, this.leafCount) + this.leafCount
    let right = clamp(endExclusive, 0, this.leafCount) + this.leafCount
    let result = 0
    while (left < right) {
      if (left % 2 === 1) {
        result = Math.max(result, this.values[left] ?? 0)
        left += 1
      }
      if (right % 2 === 1) {
        right -= 1
        result = Math.max(result, this.values[right] ?? 0)
      }
      left = Math.floor(left / 2)
      right = Math.floor(right / 2)
    }
    return result
  }
}

class BoundedCandidateHeap {
  private readonly capacity: number
  private readonly values: CoarseCandidate[] = []

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity)
  }

  add(candidate: CoarseCandidate): void {
    if (this.values.length < this.capacity) {
      this.values.push(candidate)
      this.bubbleUp(this.values.length - 1)
      return
    }
    if (candidate.coarseCost >= (this.values[0]?.coarseCost ?? Number.POSITIVE_INFINITY)) {
      return
    }
    this.values[0] = candidate
    this.sinkDown(0)
  }

  sorted(): readonly CoarseCandidate[] {
    return [...this.values].sort((left, right) => left.coarseCost - right.coarseCost)
  }

  private bubbleUp(index: number): void {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (
        (this.values[parent]?.coarseCost ?? Number.NEGATIVE_INFINITY) >=
        (this.values[current]?.coarseCost ?? Number.NEGATIVE_INFINITY)
      ) {
        return
      }
      this.swap(parent, current)
      current = parent
    }
  }

  private sinkDown(index: number): void {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let largest = current
      if (
        left < this.values.length &&
        (this.values[left]?.coarseCost ?? Number.NEGATIVE_INFINITY) >
          (this.values[largest]?.coarseCost ?? Number.NEGATIVE_INFINITY)
      ) {
        largest = left
      }
      if (
        right < this.values.length &&
        (this.values[right]?.coarseCost ?? Number.NEGATIVE_INFINITY) >
          (this.values[largest]?.coarseCost ?? Number.NEGATIVE_INFINITY)
      ) {
        largest = right
      }
      if (largest === current) {
        return
      }
      this.swap(current, largest)
      current = largest
    }
  }

  private swap(left: number, right: number): void {
    const temporary = this.values[left]
    const rightValue = this.values[right]
    if (temporary === undefined || rightValue === undefined) {
      return
    }
    this.values[left] = rightValue
    this.values[right] = temporary
  }
}

export class CandidateGenerator {
  generate(
    sequence: FeatureSequence,
    options: LoopAnalysisOptions,
    onProgress?: CandidateProgress,
  ): readonly CoarseCandidate[] {
    const { frames, hopSeconds } = sequence
    if (frames.length < 6) {
      return []
    }

    const contextRadius = 2
    const minimumFrameDistance = Math.max(2, Math.ceil(options.minimumDurationSeconds / hopSeconds))
    const maximumFrameDistance = Math.max(
      minimumFrameDistance,
      Math.floor(options.maximumDurationSeconds / hopSeconds),
    )
    const novelty = frames.map((frame) => frame.novelty)
    const noveltyMedian = Math.max(1e-5, median(novelty.slice(1)))
    const noveltyPrefix = new Float64Array(frames.length + 1)
    for (let index = 0; index < frames.length; index += 1) {
      noveltyPrefix[index + 1] = (noveltyPrefix[index] ?? 0) + (novelty[index] ?? 0)
    }
    const rangeMaximum = new RangeMaximumTree(novelty)
    const heap = new BoundedCandidateHeap(Math.max(80, options.candidateCount * 30))
    const firstAllowedFrame = this.firstFrameAtOrAfter(frames, options.searchStartSeconds)
    const lastAllowedFrame = this.lastFrameAtOrBefore(frames, options.searchEndSeconds)
    const firstStartFrame = Math.max(contextRadius, firstAllowedFrame)
    const finalAllowedEndFrame = Math.min(frames.length - contextRadius - 1, lastAllowedFrame)
    const finalStartFrame = finalAllowedEndFrame - minimumFrameDistance

    for (let startFrame = firstStartFrame; startFrame <= finalStartFrame; startFrame += 1) {
      const firstEndFrame = startFrame + minimumFrameDistance
      const finalEndFrame = Math.min(finalAllowedEndFrame, startFrame + maximumFrameDistance)

      for (let endFrame = firstEndFrame; endFrame <= finalEndFrame; endFrame += 1) {
        const recurrenceCost = this.contextDistance(frames, startFrame, endFrame, contextRadius)
        const frameCount = endFrame - startFrame
        const noveltyTotal = (noveltyPrefix[endFrame] ?? 0) - (noveltyPrefix[startFrame] ?? 0)
        const stationarityCost = clamp(
          noveltyTotal / Math.max(1, frameCount) / noveltyMedian / 3,
          0,
          2,
        )
        const rareEventCost = clamp(
          rangeMaximum.query(startFrame, endFrame) / noveltyMedian / 6,
          0,
          2,
        )
        const trajectoryCost = this.trajectoryDistance(frames, startFrame, endFrame)
        const durationSeconds = frameCount * hopSeconds
        const durationRange = Math.max(
          hopSeconds,
          options.maximumDurationSeconds - options.minimumDurationSeconds,
        )
        const normalizedLength = clamp(
          (durationSeconds - options.minimumDurationSeconds) / durationRange,
          0,
          1,
        )
        const lengthCost = 1 - normalizedLength
        const lengthWeight = this.lengthWeight(options)
        const coarseCost =
          recurrenceCost * 0.5 +
          trajectoryCost * 0.18 +
          stationarityCost * 0.13 +
          rareEventCost * 0.11 +
          lengthCost * lengthWeight

        const start = frames[startFrame]
        const end = frames[endFrame]
        if (start === undefined || end === undefined) {
          continue
        }
        heap.add({
          startFrame,
          endFrame,
          startSeconds: start.timeSeconds,
          endSeconds: end.timeSeconds,
          durationSeconds,
          recurrenceCost,
          stationarityCost,
          rareEventCost,
          trajectoryCost,
          coarseCost,
        })
      }

      if (startFrame % 20 === 0) {
        onProgress?.(
          (startFrame - firstStartFrame) / Math.max(1, finalStartFrame - firstStartFrame),
        )
      }
    }

    onProgress?.(1)
    return this.diversify(heap.sorted(), Math.max(options.candidateCount * 8, 30), hopSeconds)
  }

  private firstFrameAtOrAfter(frames: readonly FeatureFrame[], timeSeconds: number): number {
    const index = frames.findIndex((frame) => frame.timeSeconds >= timeSeconds)
    return index < 0 ? frames.length : index
  }

  private lastFrameAtOrBefore(frames: readonly FeatureFrame[], timeSeconds: number): number {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      if ((frames[index]?.timeSeconds ?? Number.POSITIVE_INFINITY) <= timeSeconds) {
        return index
      }
    }
    return -1
  }

  private contextDistance(
    frames: readonly FeatureFrame[],
    start: number,
    end: number,
    radius: number,
  ): number {
    let weightedDistance = 0
    let totalWeight = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const startFrame = frames[start + offset]
      const endFrame = frames[end + offset]
      if (startFrame === undefined || endFrame === undefined) {
        continue
      }
      const weight = radius + 1 - Math.abs(offset)
      weightedDistance += vectorDistance(startFrame.vector, endFrame.vector) * weight
      totalWeight += weight
    }
    return weightedDistance / Math.max(1, totalWeight)
  }

  private trajectoryDistance(frames: readonly FeatureFrame[], start: number, end: number): number {
    const startPrevious = frames[start - 1]
    const startCurrent = frames[start]
    const endPrevious = frames[end - 1]
    const endCurrent = frames[end]
    if (
      startPrevious === undefined ||
      startCurrent === undefined ||
      endPrevious === undefined ||
      endCurrent === undefined
    ) {
      return 1
    }

    const dimension = Math.min(startCurrent.vector.length, endCurrent.vector.length)
    if (dimension === 0) {
      return 0
    }
    let total = 0
    for (let index = 0; index < dimension; index += 1) {
      const startDelta = (startCurrent.vector[index] ?? 0) - (startPrevious.vector[index] ?? 0)
      const endDelta = (endCurrent.vector[index] ?? 0) - (endPrevious.vector[index] ?? 0)
      const difference = startDelta - endDelta
      total += difference * difference
    }
    return Math.sqrt(total / dimension)
  }

  private lengthWeight(options: LoopAnalysisOptions): number {
    if (options.mode === 'longest') {
      return 0.3
    }
    if (options.mode === 'cleanest') {
      return 0.025
    }
    return 0.18 * (1 - BALANCED_QUALITY_BIAS) + 0.035
  }

  private diversify(
    candidates: readonly CoarseCandidate[],
    maximumCount: number,
    hopSeconds: number,
  ): readonly CoarseCandidate[] {
    const selected: CoarseCandidate[] = []
    for (const candidate of candidates) {
      const isDistinct = selected.every((existing) => {
        const endpointSeparation =
          Math.abs(existing.startSeconds - candidate.startSeconds) +
          Math.abs(existing.endSeconds - candidate.endSeconds)
        const durationSeparation = Math.abs(existing.durationSeconds - candidate.durationSeconds)
        return endpointSeparation > hopSeconds * 2 || durationSeparation > 0.75
      })
      if (isDistinct) {
        selected.push(candidate)
      }
      if (selected.length >= maximumCount) {
        break
      }
    }
    return selected
  }
}
