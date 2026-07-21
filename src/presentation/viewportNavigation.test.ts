import { describe, expect, it } from 'vitest'
import { needsViewportReveal, preferredScrollBehavior } from './viewportNavigation'

describe('viewport navigation', () => {
  it('keeps a comfortably visible target in place', () => {
    expect(needsViewportReveal({ top: 24, bottom: 680 }, 800)).toBe(false)
  })

  it('reveals targets below or above the comfortable viewport', () => {
    expect(needsViewportReveal({ top: 760, bottom: 840 }, 800)).toBe(true)
    expect(needsViewportReveal({ top: 4, bottom: 84 }, 800)).toBe(true)
  })

  it('can reserve trailing viewport space for content that follows the target', () => {
    expect(needsViewportReveal({ top: 690, bottom: 760 }, 800, 16, 320)).toBe(true)
  })

  it('disables smooth scrolling when reduced motion is preferred', () => {
    expect(preferredScrollBehavior(false)).toBe('smooth')
    expect(preferredScrollBehavior(true)).toBe('auto')
  })
})
