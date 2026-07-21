export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

export function average(values: ArrayLike<number>): number {
  if (values.length === 0) {
    return 0
  }

  let total = 0
  for (let index = 0; index < values.length; index += 1) {
    total += values[index] ?? 0
  }
  return total / values.length
}

export function median(values: ArrayLike<number>): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = Array.from(values).sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  }
  return sorted[middle] ?? 0
}

export function percentile(values: ArrayLike<number>, proportion: number): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = Array.from(values).sort((left, right) => left - right)
  const position = clamp(proportion, 0, 1) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return lerp(sorted[lower] ?? 0, sorted[upper] ?? 0, position - lower)
}

export function vectorDistance(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) {
    return 0
  }

  let squaredDistance = 0
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    squaredDistance += difference * difference
  }
  return Math.sqrt(squaredDistance / length)
}

export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function nextPowerOfTwo(value: number): number {
  let result = 1
  while (result < value) {
    result *= 2
  }
  return result
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
