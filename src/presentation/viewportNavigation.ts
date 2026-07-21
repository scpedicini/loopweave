interface VerticalBounds {
  readonly top: number
  readonly bottom: number
}

export function needsViewportReveal(
  bounds: VerticalBounds,
  viewportHeight: number,
  inset = 16,
  trailingSpace = 0,
): boolean {
  return bounds.top < inset || bounds.bottom > viewportHeight - inset - trailingSpace
}

export function preferredScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth'
}
