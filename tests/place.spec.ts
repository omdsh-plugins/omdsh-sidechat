/**
 * Placement is arithmetic, and the only thing that can go wrong with it is
 * putting the box somewhere the person cannot reach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOX_WIDTH, GAP, MARGIN, POSITION_KEY,
  clampPlacement, dragTo, firstPlacement, loadPosition, placeBox, savePosition,
} from '../src/client/place.ts'

const viewport = { width: 1440, height: 900 }
const size = { width: BOX_WIDTH, height: 132 }

describe('placeBox', () => {
  it('sits just below the selection', () => {
    const rect = { left: 600, top: 300, right: 900, bottom: 320 }

    expect(placeBox(rect, viewport, size)).toEqual({ left: 600, top: 320 + GAP })
  })

  it('flips above when the bottom will not hold it', () => {
    const rect = { left: 600, top: 820, right: 900, bottom: 860 }

    expect(placeBox(rect, viewport, size)).toEqual({ left: 600, top: 820 - GAP - size.height })
  })

  it('clamps a selection near the right edge back into view', () => {
    const rect = { left: 1400, top: 100, right: 1430, bottom: 120 }

    expect(placeBox(rect, viewport, size).left).toBe(viewport.width - size.width - MARGIN)
  })

  it('keeps the left edge on screen even in a viewport narrower than the box', () => {
    const rect = { left: 10, top: 10, right: 40, bottom: 30 }

    expect(placeBox(rect, { width: 320, height: 480 }, size).left).toBe(MARGIN)
  })

  it('centres in the upper third when there was nothing to sit beside', () => {
    const placement = placeBox(undefined, viewport, size)

    expect(placement.left).toBe((viewport.width - size.width) / 2)
    // Not dead centre: a box in the middle reads as a modal, and this one is
    // deliberately not one.
    expect(placement.top).toBeLessThan(viewport.height / 2)
    expect(placement.top).toBeGreaterThanOrEqual(MARGIN)
  })

  it('clamps into a viewport too short for the box on either side of it', () => {
    const rect = { left: 100, top: 200, right: 200, bottom: 220 }

    const placement = placeBox(rect, { width: 1440, height: 300 }, size)

    expect(placement.top).toBeGreaterThanOrEqual(MARGIN)
  })
})

describe('clampPlacement', () => {
  it('leaves a position that already fits alone', () => {
    expect(clampPlacement({ left: 300, top: 200 }, viewport, size)).toEqual({ left: 300, top: 200 })
  })

  it('pulls a position the viewport no longer holds back into view', () => {
    // The case that matters: a window resized smaller must not leave the
    // header — the only way to drag the panel back — off the screen.
    const placement = clampPlacement({ left: 3000, top: 2000 }, viewport, size)

    expect(placement.left).toBe(viewport.width - size.width - MARGIN)
    expect(placement.top).toBe(viewport.height - size.height - MARGIN)
  })

  it('keeps the top-left on screen when the viewport is smaller than the panel', () => {
    expect(clampPlacement({ left: 900, top: 900 }, { width: 320, height: 100 }, size))
      .toEqual({ left: MARGIN, top: MARGIN })
  })
})

describe('dragTo', () => {
  it('moves by the pointer delta', () => {
    expect(dragTo({ left: 300, top: 200 }, 40, -25, viewport, size)).toEqual({ left: 340, top: 175 })
  })

  it('is measured from where the drag started, not from the last frame', () => {
    // Accumulating per-frame deltas drifts; this takes the total each time.
    const origin = { left: 300, top: 200 }

    expect(dragTo(origin, 10, 10, viewport, size)).toEqual({ left: 310, top: 210 })
    expect(dragTo(origin, 20, 20, viewport, size)).toEqual({ left: 320, top: 220 })
  })

  it('cannot be dragged out of the viewport', () => {
    expect(dragTo({ left: 300, top: 200 }, -9999, -9999, viewport, size))
      .toEqual({ left: MARGIN, top: MARGIN })
  })
})

describe('firstPlacement', () => {
  it('takes the offered spot when it has never been placed', () => {
    expect(firstPlacement(undefined, { left: 100, top: 100 })).toEqual({ left: 100, top: 100 })
  })

  it('keeps the position it already has, whatever is offered', () => {
    // The rule the whole gesture rests on: summoning brings the panel back,
    // it does not move it.
    expect(firstPlacement({ left: 800, top: 400 }, { left: 100, top: 100 }))
      .toEqual({ left: 800, top: 400 })
  })
})

describe('remembered position', () => {
  // An in-memory Storage rather than jsdom's. Node 22 ships an experimental
  // `localStorage` global that shadows jsdom's inside vitest and answers with
  // a stub that has no `clear` — a real trap, and one a stub sidesteps
  // entirely while testing exactly the same code path.
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    })
  })

  it('is nothing on a first visit', () => {
    expect(loadPosition()).toBeUndefined()
  })

  it('survives a reload, so "first time" means the first time ever', () => {
    savePosition({ left: 800, top: 400 })

    expect(loadPosition()).toEqual({ left: 800, top: 400 })
  })

  it('treats a malformed record as a first visit rather than a crash', () => {
    localStorage.setItem(POSITION_KEY, '{"left":"nope"}')

    expect(loadPosition()).toBeUndefined()
  })

  it('treats a record from a future version as a first visit', () => {
    localStorage.setItem(POSITION_KEY, 'not json at all')

    expect(loadPosition()).toBeUndefined()
  })
})
