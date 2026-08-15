/**
 * Where the box sits: beside the thing you asked about, never off the screen.
 *
 * Pure arithmetic over two rectangles, kept out of the component so it can be
 * checked without a layout engine. The rules are short enough to state whole:
 * prefer just below the selection, flip above when the bottom would not hold
 * it, clamp into the viewport either way, and centre when there was no
 * selection to sit beside.
 *
 * The box does NOT follow a selection that moves while it is open. Its
 * position is where you summoned it; only the anchor chip changes. A box that
 * jumps around while you are typing into it is a box you have to chase.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/place
 */

/** localStorage key the panel's position is remembered under. */
export const POSITION_KEY = 'omdsh-sidechat.position'

/** Width of the panel, in px. */
export const BOX_WIDTH = 420
/** Height of the panel, in px. */
export const BOX_HEIGHT = 520
/** Gap between the panel and the selection it first appeared beside, in px. */
export const GAP = 8
/** Minimum distance from any viewport edge, in px. */
export const MARGIN = 12

/** The panel's fixed size, as both placement and layout use it. */
export const BOX_SIZE = { width: BOX_WIDTH, height: BOX_HEIGHT }

/**
 * Where on the screen the question was asked, in viewport coordinates. A plain
 * record rather than the live `DOMRect`: it has to survive being written from
 * a spec with no layout engine.
 */
export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** The visible area the box has to fit inside. */
export interface Viewport {
  width: number
  height: number
}

/** The box's measured size. */
export interface BoxSize {
  width: number
  height: number
}

/** Viewport-relative position of the box's top-left corner. */
export interface Placement {
  left: number
  top: number
}

/**
 * Position the box.
 * @param rect - the selection's box, or undefined when there was none.
 * @param viewport - the visible area.
 * @param size - the box's measured size.
 * @returns where to put its top-left corner.
 */
export function placeBox(rect: AnchorRect | undefined, viewport: Viewport, size: BoxSize): Placement {
  if (rect === undefined) {
    // Nothing to sit beside: the upper third, centred. Not the middle — a box
    // dead-centre reads as a modal, and this one deliberately is not.
    return {
      left: clamp((viewport.width - size.width) / 2, MARGIN, viewport.width - size.width - MARGIN),
      top: clamp(viewport.height * 0.22, MARGIN, viewport.height - size.height - MARGIN),
    }
  }

  const left = clamp(rect.left, MARGIN, viewport.width - size.width - MARGIN)
  const below = rect.bottom + GAP
  const above = rect.top - GAP - size.height
  const fitsBelow = below + size.height <= viewport.height - MARGIN
  const top = fitsBelow ? below : above >= MARGIN ? above : clamp(below, MARGIN, viewport.height - size.height - MARGIN)
  return { left, top }
}

/**
 * Keep a position inside the viewport.
 *
 * Applied on every read rather than only on write, because the viewport is
 * what changes: a window resized smaller must not leave the panel — and its
 * header, which is the only way to drag it back — off the screen.
 * @param position - the remembered position.
 * @param viewport - the visible area.
 * @param size - the panel's size.
 * @returns the position, constrained.
 */
export function clampPlacement(position: Placement, viewport: Viewport, size: BoxSize): Placement {
  return {
    left: clamp(position.left, MARGIN, viewport.width - size.width - MARGIN),
    top: clamp(position.top, MARGIN, viewport.height - size.height - MARGIN),
  }
}

/**
 * The position a drag has reached.
 * @param origin - where the panel was when the drag started.
 * @param dx - pointer movement since, on x.
 * @param dy - pointer movement since, on y.
 * @param viewport - the visible area.
 * @param size - the panel's size.
 * @returns the new position, constrained.
 */
export function dragTo(
  origin: Placement,
  dx: number,
  dy: number,
  viewport: Viewport,
  size: BoxSize,
): Placement {
  return clampPlacement({ left: origin.left + dx, top: origin.top + dy }, viewport, size)
}

/**
 * Constrain a value, tolerating an inverted range.
 *
 * A viewport narrower than the box makes `max` smaller than `min`; pinning to
 * `min` there keeps the box's own left edge on screen, which is the half that
 * matters.
 * @param value - the candidate.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the constrained value.
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.round(Math.max(min, Math.min(max, value)))
}

/**
 * Where a summon should put the panel.
 *
 * The rule the whole gesture rests on: the offered spot is taken ONCE. After
 * that the panel is wherever the person left it, and a summon brings it back
 * rather than moving it — a window that re-placed itself every time would
 * drift around the screen as you worked.
 * @param stored - the position it already has, if any.
 * @param beside - where to put it if it has none.
 * @returns the position to use.
 */
export function firstPlacement(stored: Placement | undefined, beside: Placement): Placement {
  return stored ?? beside
}

/**
 * The remembered position. A missing, unreadable or malformed record is not an
 * error — it is a first visit, and appearing beside the selection is the
 * answer.
 * @returns the position, or undefined.
 */
export function loadPosition(): Placement | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(POSITION_KEY)
    if (raw === null || raw === undefined) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { left, top } = parsed as Placement
    if (!Number.isFinite(left) || !Number.isFinite(top)) return undefined
    return { left, top }
  } catch {
    return undefined
  }
}

/**
 * Remember where the panel was left.
 * @param position - the position to keep.
 */
export function savePosition(position: Placement): void {
  try {
    globalThis.localStorage?.setItem(POSITION_KEY, JSON.stringify(position))
  } catch {
    // Storage disabled or private mode: the panel simply starts beside the
    // selection again next reload, which is a working panel.
  }
}
