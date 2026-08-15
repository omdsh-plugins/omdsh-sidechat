/**
 * Where the summon icon goes when the session header is not showing it.
 *
 * The harness publishes one frame-wide floating seat (`shell.overlay`) and no
 * seat at all in the column Code mode occupies, so the fallback surface has to
 * place itself. It does that off PUBLISHED attributes rather than class names
 * or DOM shape — `[data-slot="conversation"]`, the slot renderer's stable
 * per-slot anchor whose parent is the frame's centre column, and
 * `[data-slot="shell.overlay"]`, whose DIRECT children are one element per
 * registered floating entry. Absent the column it declines to place anything,
 * which is the honest degradation: no icon beats an icon over someone else's
 * control.
 *
 * ## One corner, more than one occupant
 *
 * The icon's home is the header's right-aligned utility row, so its stand-in
 * takes the column's top-right corner — the same pixels, inset by the header's
 * own measured padding, at the same row height, so nothing jumps when the
 * header comes and goes. That corner is shared: `omdsh-sidepanel`'s switches sit
 * further out in the row and stand in at the same corner, and `omdsh-usage`'s
 * badge tucks in from the other side once the header stops drawing it.
 *
 * Packing them without a shared registry needs one rule that cannot cycle, and
 * this is it: **each occupant measures only the OUTERMOST run of furniture and
 * tucks inboard of it.** This module takes the entry whose RIGHT edge is
 * furthest right — the one actually holding the corner — and never the leftmost
 * one, so a surface that has already tucked itself in is invisible to this
 * measurement and cannot push it further. `omdsh-usage` reads the leftmost
 * instead, which puts it inboard of this icon; the dependency runs one way and
 * the chain settles in a single pass.
 *
 * Timing is the other half of that. The measurement runs in a LAYOUT effect,
 * so the strip is in the document before the frame paints and before any
 * `requestAnimationFrame` measurement of the same corner runs — an understudy
 * that appeared a frame late would be one the next occupant inboard had already
 * measured around.
 *
 * This module reads other plugins' boxes and nothing else about them: not their
 * code, not their state, not their identity — only "is anything holding this
 * corner, and where does it start", which is a question about the frame. A
 * composition with an empty corner measures nothing and the icon takes the
 * header's own padding.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/header-anchor
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { SIDECHAT_ROOT_ATTR } from '../conventions.ts'

/** The slot-renderer anchor whose parent IS the frame's centre column. */
const CENTER_ANCHOR = '[data-slot="conversation"]'

/** The slot-renderer anchor holding whatever draws the session header. */
const HEADER_ANCHOR = '[data-slot="conversation.session.header"]'

/**
 * The slot-renderer anchor inside the frame's floating layer. Its own children
 * are the registered entries: one element per surface floating on the frame,
 * because a list slot renders its entries directly rather than wrapping each.
 */
const OVERLAY_ANCHOR = '[data-slot="shell.overlay"]'

/** The floating layer itself, as the fallback when the anchor is not addressable. */
const OVERLAY_LAYER = '[data-shell-overlay]'

/** This plugin's own strip, so a measurement of the corner excludes it. */
export const STRIP_ATTRIBUTE = 'data-omdsh-sidechat-strip'

/**
 * The shipped header's own padding, in px, used when it cannot be measured.
 * Mirrored rather than invented: the icon keeps its place in the utility row
 * while the header hides it, so these are the numbers that make "the same
 * place" true.
 */
const HEADER_PAD_TOP = 12
const HEADER_PAD_RIGHT = 28

/**
 * The header's utility row height in px — what centres the icon in it.
 *
 * The shipped row is `min-height: 32px` and its utilities are 32px capsules, so
 * this is the height at which the understudy lands on the very pixels the
 * header's own icon occupies rather than a px below them.
 */
export const HEADER_ROW_HEIGHT = 32

/** Clearance kept between the icon and the furniture it sits inboard of. */
export const FURNITURE_GAP = 8

/**
 * How far below the row's top an element still counts as being IN it, and how
 * tall a box may be and still be row furniture.
 *
 * The height half is what keeps this plugin's own panel — and any other
 * summoned surface a person has dragged into the corner — from being read as a
 * control in the header row. A row occupant is row-height; a panel is not.
 */
const BAND_HEIGHT = 44

/**
 * The frame's centre column: the conversation's grid item. `display: contents`
 * on the slot anchor is what makes its PARENT the box worth measuring.
 * @returns the column element, or null when this page has no conversation slot.
 */
export function centerColumn(): HTMLElement | null {
  const parent = document.querySelector(CENTER_ANCHOR)?.parentElement ?? null
  return parent instanceof HTMLElement ? parent : null
}

/**
 * The header's own padding, read off the shipped header when it is on the page.
 *
 * `getComputedStyle` answers for a `display: none` element too, which is
 * exactly what a blank conversation's header is — so the icon can hold that
 * header's padding while the header itself holds nothing.
 * @returns the two insets in px; the shipped numbers when there is no header to ask.
 */
export function headerPadding(): { top: number; right: number } {
  const header = document.querySelector(`${HEADER_ANCHOR} header`)
  if (header === null) return { top: HEADER_PAD_TOP, right: HEADER_PAD_RIGHT }
  const style = getComputedStyle(header)
  const read = (value: string, fallback: number): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return { top: read(style.paddingTop, HEADER_PAD_TOP), right: read(style.paddingRight, HEADER_PAD_RIGHT) }
}

/** A box, in the only terms this module's arithmetic needs. */
export interface Box {
  left: number
  right: number
  top: number
  width: number
  height: number
}

/**
 * The left edge of whatever is holding the column's top-right corner.
 *
 * Four conditions, and each one is load-bearing:
 *
 * - **row-height, not panel-height.** A dragged panel can cover this corner and
 *   is not furniture in this row; without the height bound the icon would flee
 *   to the middle of the column whenever one was parked there.
 * - **starting right of the column's midpoint.** That is what "corner
 *   furniture" means here; the centred mode switch's own box begins left of it.
 * - **inside the column, at the header's own height.** The frame's floating
 *   layer spans the harness sidebar and the details panel too, and a control
 *   belonging to one of those is not in this corner at all.
 * - **the RIGHTMOST right edge wins.** The occupant actually holding the corner
 *   is the one to tuck inboard of. Taking the leftmost instead would measure
 *   surfaces that have themselves already tucked in — and since one of them
 *   measures this one, the two would chase each other outward for as long as
 *   either kept looking.
 * @param column - the measured centre column.
 * @param furniture - the candidate boxes, one per registered floating entry.
 * @returns the corner holder's left edge, or undefined when the corner is empty.
 */
export function cornerHolderLeft(column: Box, furniture: readonly Box[]): number | undefined {
  const midpoint = column.left + column.width / 2
  let held: Box | undefined
  for (const box of furniture) {
    if (box.width <= 0 || box.height <= 0 || box.height > BAND_HEIGHT) continue
    if (box.left <= midpoint || box.left >= column.right) continue
    if (box.top < column.top || box.top > column.top + BAND_HEIGHT) continue
    if (held === undefined || box.right > held.right) held = box
  }
  return held?.left
}

/**
 * The floating entries this plugin does not own, as plain boxes.
 *
 * Direct children of the overlay anchor only — one per registered entry. The
 * mode switch's segments are descendants of its own entry, and descending would
 * find them and drop this icon on top of the control they belong to.
 * @returns the measured boxes; empty when the layer is not addressable.
 */
export function overlayFurniture(): Box[] {
  const anchor = document.querySelector(OVERLAY_ANCHOR) ?? document.querySelector(OVERLAY_LAYER)
  if (anchor === null) return []
  const boxes: Box[] = []
  for (const element of anchor.children) {
    // This plugin's own two surfaces: the strip being placed, and the panel it
    // summons. Measuring either would be this icon placing itself against
    // itself.
    if (element.hasAttribute(STRIP_ATTRIBUTE) || element.hasAttribute(SIDECHAT_ROOT_ATTR)) continue
    const rect = element.getBoundingClientRect()
    boxes.push({ left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height })
  }
  return boxes
}

/** Where the understudy icon sits, in viewport px. */
export interface HeaderAnchor {
  /** The row's top edge. */
  top: number
  /** The icon's right edge, as an inset from the viewport's right. */
  right: number
}

/**
 * Turn one reading of the column and its corner into a placement.
 *
 * The inset is never smaller than the header's own padding: a furniture
 * measurement that would push the icon off the column — a stale box, a surface
 * mid-teardown — is clamped back to the corner rather than trusted.
 * @param column - the measured centre column.
 * @param furniture - the candidate boxes, one per registered floating entry.
 * @param padding - the header's own insets.
 * @param viewportWidth - the viewport width the inset is expressed against.
 * @returns the placement, or undefined for a column mid-teardown.
 */
export function placeStrip(
  column: Box,
  furniture: readonly Box[],
  padding: { top: number; right: number },
  viewportWidth: number,
): HeaderAnchor | undefined {
  // A zero-width box is a column mid-teardown; snapping to the viewport edge
  // and back is worse than keeping the last good reading.
  if (column.width <= 0) return undefined
  const corner = viewportWidth - column.right + padding.right
  const holder = cornerHolderLeft(column, furniture)
  return {
    top: column.top + padding.top,
    right: holder === undefined ? corner : Math.max(corner, viewportWidth - holder + FURNITURE_GAP),
  }
}

/**
 * The frame's floating layer, whose direct children are the registered entries.
 * @returns the layer, or null when this page has none.
 */
function overlayLayer(): Element | null {
  return document.querySelector(OVERLAY_ANCHOR) ?? document.querySelector(OVERLAY_LAYER)
}

/** Measure the placement once, off the live document. */
function measurePlacement(): HeaderAnchor | undefined {
  const column = centerColumn()
  if (column === null) return undefined
  const rect = column.getBoundingClientRect()
  const box: Box = {
    left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height,
  }
  return placeStrip(box, overlayFurniture(), headerPadding(), window.innerWidth)
}

/**
 * Track where the understudy icon belongs.
 *
 * Re-measured on four signals, and the last two are the ones a resize observer
 * cannot see:
 *
 * - the **column's box**, which the harness sidebar's collapse transition and
 *   any panel margin move at animation cadence;
 * - the **window**, for the obvious reason;
 * - **`generation`**, the caller saying "the seat changed, look again". The
 *   column keeps its exact geometry when Code mode takes it, so nothing about
 *   its box says anything happened. It is passed the same value that decides
 *   whether this surface renders at all, so the two can never disagree;
 * - **the corner's other occupants moving.** They are fixed boxes on the same
 *   floating layer, so one of them relocating is neither a resize nor a change
 *   of anything this surface owns. `omdsh-usage`'s badge does exactly that on
 *   every mode change — it holds the column's leading corner while the
 *   conversation is the column and the trailing one while a terminal is — and
 *   without this the icon would tuck inboard of where that badge USED to be
 *   and stay there, stranded mid-column, until the next resize.
 *
 * That last observer watches the layer's child list and each child's own
 * `style`, never the subtree: the children are a handful of surfaces, while
 * their subtrees include a terminal that rewrites inline styles every frame it
 * paints.
 *
 * The first measurement of each generation is a LAYOUT effect on purpose — see
 * the module note. Everything after it is rAF-throttled.
 * @param generation - changes whenever what occupies the column may have changed.
 * @returns the placement, or undefined until there is one.
 */
export function useHeaderAnchor(generation: unknown): HeaderAnchor | undefined {
  const [placement, setPlacement] = useState<HeaderAnchor | undefined>(undefined)
  // Kept in a ref so the observer effect mounts once per generation while the
  // comparison still sees the newest published value.
  const current = useRef<HeaderAnchor | undefined>(undefined)
  current.current = placement

  useLayoutEffect(() => {
    const column = centerColumn()
    if (column === null) return undefined

    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const next = measurePlacement()
      if (next === undefined) return
      const held = current.current
      // The equality check is also what stops this observing its own writes:
      // placing the strip changes the strip's style, which is a mutation this
      // very observer sees.
      if (held !== undefined && held.top === next.top && held.right === next.right) return
      setPlacement(next)
    }
    const schedule = (): void => { frame ??= requestAnimationFrame(measure) }

    const sizes = new ResizeObserver(schedule)
    sizes.observe(column)
    window.addEventListener('resize', schedule)

    const layer = overlayLayer()
    const moves = new MutationObserver((records) => {
      // A surface that came or went brings its own style with it; re-arm on the
      // new child set before measuring against it.
      if (records.some(record => record.type === 'childList')) watchChildren()
      schedule()
    })
    function watchChildren(): void {
      if (layer === null) return
      for (const child of layer.children) moves.observe(child, { attributes: true, attributeFilter: ['style'] })
    }
    if (layer !== null) {
      moves.observe(layer, { childList: true })
      watchChildren()
    }

    // Synchronous, not scheduled: this runs before the frame paints, which is
    // what puts the strip on screen ahead of every rAF measurement of the same
    // corner.
    measure()

    return () => {
      sizes.disconnect()
      moves.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [generation])

  return placement
}
