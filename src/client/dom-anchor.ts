/**
 * The built-in anchor sources: what the browser can say about where you are
 * without anyone having been asked to cooperate.
 *
 * Two readings, in one pass over the live selection:
 *
 *   1. the selected TEXT, which is the quotation;
 *   2. the nearest ancestors carrying {@link ANCHOR_PATH_ATTR} and
 *      {@link ANCHOR_LINE_ATTR}, which are the coordinates.
 *
 * Both are optional and they fail independently. A surface that publishes
 * neither still yields a usable anchor as long as something is selected; a
 * surface that publishes the path but has no line structure yields a file with
 * no range. What never happens is a read of the filesystem: the excerpt is the
 * text already on the screen, which is why this plugin needs no host half and
 * no path fence.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/dom-anchor
 */

import { ANCHOR_LINE_ATTR, ANCHOR_PATH_ATTR, SIDECHAT_ROOT_ATTR } from '../conventions.ts'
import type { Anchor } from './anchor.ts'

/**
 * Read the live selection as an anchor.
 * @param selection - the document's selection, or null where there is none.
 * @returns the anchor, or undefined when the selection says nothing usable.
 */
export function selectionAnchor(selection: Selection | null): Anchor | undefined {
  if (selection === null || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  if (start === null) return undefined
  // Never quote our own input back into our own prompt.
  if (start.closest(`[${SIDECHAT_ROOT_ATTR}]`) !== null) return undefined

  const path = readPath(start)
  // Trailing newlines come free with a multi-row selection and mean nothing in
  // a quotation; leading indentation is load-bearing and is left alone.
  const excerpt = selection.toString().replace(/\s+$/, '')
  const lines = readRange(start, end, range)

  if (excerpt === '') {
    // A collapsed caret is not a quotation, but the surface under it may still
    // be worth naming — that is the difference between 'element' and 'none'.
    if (path === undefined) return undefined
    return { origin: 'element', path, ...(lines === undefined ? {} : { range: lines }) }
  }
  return {
    origin: 'selection',
    excerpt,
    ...(path === undefined ? {} : { path }),
    ...(lines === undefined ? {} : { range: lines }),
  }
}

/**
 * The viewport rect the overlay should sit beside: the selection's own box.
 *
 * Placement, not content — it is here because it is another reading of the
 * same Range, and it is deliberately NOT part of {@link Anchor}, which must
 * stay a fact about the workspace rather than about the screen.
 * @param selection - the document's selection, or null.
 * @returns the rect, or undefined when there is nothing to sit beside.
 */
export function selectionRect(selection: Selection | null): DOMRect | undefined {
  if (selection === null || selection.rangeCount === 0) return undefined
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  // A collapsed caret in a hidden subtree reports an all-zero box, which would
  // pin the overlay to the top-left corner. Centre it instead.
  if (rect.width === 0 && rect.height === 0) return undefined
  return rect
}

/**
 * Keep the current selection alive across a click on a control.
 *
 * This is what makes a clickable entry point possible at all. Pressing a
 * button normally collapses the document selection and moves focus before the
 * click handler ever runs — so a button that summons the box would arrive to
 * find the anchor gone, every time, and the one thing this plugin exists for
 * would be the one thing the mouse could not do.
 *
 * Preventing the default on POINTERDOWN (not click) is what stops that: the
 * browser skips the focus-and-collapse step, the click still fires, and the
 * selection is still there when it does. The same move a formatting toolbar
 * makes for the same reason.
 * @param event - the pointerdown, before anything has been collapsed.
 */
export function keepSelection(event: { preventDefault: () => void }): void {
  event.preventDefault()
}

/**
 * The nearest element at or above a node.
 * @param node - any node from a Range.
 * @returns the element, or null for a detached node.
 */
function elementOf(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement
}

/**
 * The path the surface publishes, from the nearest ancestor that publishes
 * one.
 * @param from - element at the selection start.
 * @returns the path, or undefined when nothing up the tree named itself.
 */
function readPath(from: Element): string | undefined {
  const holder = from.closest(`[${ANCHOR_PATH_ATTR}]`)
  const raw = holder?.getAttribute(ANCHOR_PATH_ATTR)?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

/**
 * The 1-based line a row publishes, from the nearest ancestor that publishes
 * one.
 * @param from - element inside the row.
 * @returns the line, or undefined when the surface has no line structure.
 */
function readLine(from: Element | null): number | undefined {
  if (from === null) return undefined
  const holder = from.closest(`[${ANCHOR_LINE_ATTR}]`)
  const raw = holder?.getAttribute(ANCHOR_LINE_ATTR)
  if (raw === undefined || raw === null) return undefined
  const line = Number.parseInt(raw, 10)
  return Number.isFinite(line) && line > 0 ? line : undefined
}

/**
 * The line range a selection covers, ordered.
 * @param start - element at the selection start.
 * @param end - element at the selection end, or null.
 * @param range - the live range, read for the end-of-line correction below.
 * @returns the inclusive range, or undefined when neither end published a line.
 */
function readRange(start: Element, end: Element | null, range: Range): readonly [number, number] | undefined {
  const first = readLine(start)
  const rawLast = readLine(end)
  if (first === undefined && rawLast === undefined) return undefined
  if (first === undefined) return [rawLast as number, rawLast as number]
  if (rawLast === undefined) return [first, first]
  // Dragging to the beginning of the next row selects nothing on it, and
  // reporting that row would claim a line the person never touched.
  const last = rawLast > first && range.endOffset === 0 ? rawLast - 1 : rawLast
  return first <= last ? [first, last] : [last, first]
}
