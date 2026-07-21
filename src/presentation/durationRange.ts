import { clamp } from '../core/dsp/math'

export const SOURCE_MAXIMUM_DURATION = 0
const DURATION_STEPS_PER_SECOND = 10

export interface DurationRange {
  readonly minimumSeconds: number
  readonly maximumSeconds: number
}

export interface DurationRangeForSource extends DurationRange {
  readonly availableMaximumSeconds: number
}

export function durationRangeForSource(
  sourceDurationSeconds: number,
  previousRange?: DurationRange,
): DurationRangeForSource {
  const availableMaximumSeconds = Math.max(0.5, sourceDurationSeconds - 0.35)
  const selectableMaximumSeconds =
    Math.floor((availableMaximumSeconds + Number.EPSILON) * DURATION_STEPS_PER_SECOND) /
    DURATION_STEPS_PER_SECOND

  if (
    previousRange === undefined ||
    !Number.isFinite(previousRange.minimumSeconds) ||
    !Number.isFinite(previousRange.maximumSeconds)
  ) {
    return {
      availableMaximumSeconds,
      minimumSeconds: Math.min(15, Math.max(0.4, selectableMaximumSeconds)),
      maximumSeconds: SOURCE_MAXIMUM_DURATION,
    }
  }

  if (previousRange.maximumSeconds === SOURCE_MAXIMUM_DURATION) {
    return {
      availableMaximumSeconds,
      minimumSeconds: clamp(previousRange.minimumSeconds, 0.4, selectableMaximumSeconds),
      maximumSeconds: SOURCE_MAXIMUM_DURATION,
    }
  }

  const maximumSeconds = clamp(previousRange.maximumSeconds, 0.5, selectableMaximumSeconds)
  return {
    availableMaximumSeconds,
    minimumSeconds: clamp(previousRange.minimumSeconds, 0.4, maximumSeconds),
    maximumSeconds,
  }
}

export function resolveMaximumDurationSeconds(
  selectedMaximumSeconds: number,
  availableMaximumSeconds: number,
): number {
  return selectedMaximumSeconds === SOURCE_MAXIMUM_DURATION
    ? availableMaximumSeconds
    : selectedMaximumSeconds
}
