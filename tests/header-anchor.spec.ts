/**
 * Where the summon icon stands when the header's utility row is not on screen.
 *
 * The corner is shared with other plugins' understudies, and the rule that
 * packs them without a registry is the thing worth pinning: measure only the
 * occupant actually HOLDING the corner, never one that has already tucked
 * itself in. Get that backwards and two surfaces each place themselves against
 * the other, which is a bug no screenshot taken a frame later would show.
 */
import { describe, expect, it } from 'vitest'
import type { Box } from '../src/client/header-anchor.ts'
import { FURNITURE_GAP, cornerHolderLeft, placeStrip } from '../src/client/header-anchor.ts'

/**
 * The centre column of a wide frame with the harness sidebar open and a
 * details panel beyond the column's right edge. Its midpoint is 860, which is
 * where the centred mode switch straddles in a real frame.
 */
const column: Box = { left: 300, right: 1420, top: 60, width: 1120, height: 800 }

const padding = { top: 12, right: 28 }
const VIEWPORT = 1600

/**
 * A row-height box in the header band, given its right edge and width.
 * @param right - its right edge in viewport px.
 * @param width - its width in px.
 * @returns the box.
 */
function furniture(right: number, width: number): Box {
  return { left: right - width, right, top: column.top + 12, width, height: 32 }
}

describe('cornerHolderLeft', () => {
  it('has nothing to report on an empty corner', () => {
    expect(cornerHolderLeft(column, [])).toBeUndefined()
  })

  it('reports the occupant holding the corner', () => {
    const sidePanelSwitches = furniture(1392, 150)

    expect(cornerHolderLeft(column, [sidePanelSwitches])).toBe(1242)
  })

  it('ignores an occupant that has already tucked itself inboard', () => {
    // The shape that would cycle: this plugin measures the corner holder, and
    // the badge inboard of it measures this plugin. Taking the RIGHTMOST right
    // edge is what makes the dependency run one way.
    const sidePanelSwitches = furniture(1392, 150)
    const badgeFurtherIn = furniture(1230, 120)

    expect(cornerHolderLeft(column, [badgeFurtherIn, sidePanelSwitches])).toBe(1242)
  })

  it('ignores a panel parked in the corner', () => {
    // Tall, so not a control in a header row — this plugin's own box dragged
    // there is the obvious case, and it must not shove the icon.
    const panel = { left: 1080, right: 1392, top: column.top + 12, width: 312, height: 420 }

    expect(cornerHolderLeft(column, [panel])).toBeUndefined()
  })

  it('ignores the centred mode switch, whose box begins left of the midpoint', () => {
    const modeSwitch = { left: 735, right: 985, top: column.top + 8, width: 250, height: 34 }

    expect(cornerHolderLeft(column, [modeSwitch])).toBeUndefined()
  })

  it('ignores furniture belonging to the panels either side of the column', () => {
    const detailsPanelControl = furniture(1580, 90)

    expect(cornerHolderLeft(column, [detailsPanelControl])).toBeUndefined()
  })

  it('ignores anything below the header band', () => {
    const composerControl = { left: 1280, right: 1392, top: column.top + 700, width: 112, height: 32 }

    expect(cornerHolderLeft(column, [composerControl])).toBeUndefined()
  })

  it('ignores a surface that is registered but rendering nothing', () => {
    const collapsed = { left: 1392, right: 1392, top: column.top + 12, width: 0, height: 0 }

    expect(cornerHolderLeft(column, [collapsed])).toBeUndefined()
  })
})

describe('placeStrip', () => {
  it("takes the header's own corner when nothing else holds it", () => {
    expect(placeStrip(column, [], padding, VIEWPORT)).toEqual({
      top: column.top + padding.top,
      right: VIEWPORT - column.right + padding.right,
    })
  })

  it('tucks inboard of the occupant holding the corner', () => {
    const sidePanelSwitches = furniture(1392, 150)
    const placed = placeStrip(column, [sidePanelSwitches], padding, VIEWPORT)

    expect(placed?.right).toBe(VIEWPORT - 1242 + FURNITURE_GAP)
  })

  it('never sits tighter to the edge than the header would', () => {
    // Furniture hugging the column's edge harder than the header's own padding
    // — a surface with no inset of its own, or one caught mid-transition. The
    // padding is the floor, not a suggestion: the icon holds the row's place.
    const hugging: Box = { left: 1405, right: 1413, top: column.top + 12, width: 8, height: 32 }
    const placed = placeStrip(column, [hugging], padding, VIEWPORT)

    expect(placed?.right).toBe(VIEWPORT - column.right + padding.right)
  })

  it('declines to place anything against a column mid-teardown', () => {
    const collapsing: Box = { ...column, width: 0, right: column.left }

    expect(placeStrip(collapsing, [], padding, VIEWPORT)).toBeUndefined()
  })
})
