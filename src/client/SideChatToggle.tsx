/**
 * The way in that does not need a keyboard: one icon in the session header's
 * right-aligned utility row, and the same icon standing in for that row
 * wherever the row itself is away.
 *
 * Its home is where `omdsh-sidepanel`'s two switches sit, for the same reason —
 * the harness publishes that row as the seat for per-session utilities, so a
 * control there lands beside every other session control and nothing has to be
 * nudged aside. The row is a LIST slot, so this entry is purely additive:
 * omdsh-sidepanel is not modified, not imported, and not aware of this.
 *
 * Two things make it more than a convenience:
 *
 *   - **it is the whole entry point while no chord is bound.** `setSummonChord
 *     (null)` hands the key to somebody else, and without this icon that would
 *     leave the box reachable only by another plugin's grace;
 *   - **it teaches the chord.** The tooltip carries the current binding, so
 *     someone who found this with the mouse can stop using the mouse for it.
 *
 * ## Why there are two seats
 *
 * That row is not always on screen, and the two states where it is missing are
 * both ordinary:
 *
 *   - a **blank conversation**, where the harness clears the entire header for
 *     the hero — so the very first thing a person sees offers no way in;
 *   - **Code mode**, where the whole `conversation` seat is shadowed by a
 *     terminal, header and all. There the summon chord is yielded to the
 *     terminal as well (a terminal has every right to its own keys), so
 *     without a stand-in this plugin would be unreachable for as long as Code
 *     mode was on.
 *
 * So the same button has an understudy on the frame's floating layer, holding
 * the corner the utility row occupies — same padding, same row height, so the
 * icon does not move when the header comes and goes. It stands down whenever
 * the header seat reports itself, and what it waits on is that report rather
 * than a re-derivation of when the harness hides its own header — see
 * [header-seat](./header-seat.ts).
 *
 * The hard part is not the button, it is not destroying the selection while
 * pressing it — see `keepSelection`. Without that, clicking here would collapse
 * the selection before the click handler ran and the box would open anchored
 * to nothing, every single time.
 *
 * Unlike the side panels' switches this renders in chat mode too, because the box
 * itself works in chat mode: there is no anchor there, and an input with no
 * anchor is still an input.
 */

import { useLayoutEffect } from 'react'
import { IconSparkle16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatAccelerator } from './chord.ts'
import type { OverlayToggleProps, SideChatToggleProps } from './contract.ts'
import { keepSelection } from './dom-anchor.ts'
import { HEADER_ROW_HEIGHT, STRIP_ATTRIBUTE, useHeaderAnchor } from './header-anchor.ts'
import { isSeated } from './header-seat.ts'
import css from './SideChat.module.css'

/**
 * Whether to write chords the way Apple does.
 *
 * Read once per render off the platform hint rather than threaded in as
 * configuration: it decides glyphs in a tooltip and nothing else, and a
 * deployment has no reason to override how the machine it is running on spells
 * its own modifier keys.
 * @returns true on a Mac.
 */
function isMac(): boolean {
  return /Mac|iPhone|iPad/i.test(globalThis.navigator?.userAgent ?? '')
}

/** What either seat needs to draw the button. */
interface SummonProps {
  /** The bound chord in accelerator syntax, or undefined while unbound. */
  accelerator: string | undefined
  /** Summon the panel. */
  open: () => void
  /** Locale translate. */
  t: SideChatToggleProps['t']
}

/**
 * The button itself, identical in both seats.
 * @param props - the binding to teach, the summon, and copy.
 * @returns the button.
 */
function Summon({ accelerator, open, t }: SummonProps) {
  const chord = accelerator === undefined ? undefined : formatAccelerator(accelerator, isMac())

  return (
    <Tooltip label={chord === undefined ? t('toggle.label') : t('toggle.hint', { chord })} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.toggle}
        aria-label={t('toggle.label')}
        // The selection IS the anchor. Pressing a button would normally
        // collapse it before this handler ever runs.
        onPointerDown={keepSelection}
        onClick={open}
      >
        <IconSparkle16 />
      </button>
    </Tooltip>
  )
}

/**
 * Render the summon icon in the session header, and hold the seat while it is
 * there.
 *
 * The claim is a layout effect, not a plain one: it must land before the
 * browser paints, or the frame in which the header returns would show both this
 * icon and the understudy.
 * @param props - composed slot props (contract.ts).
 * @returns the button.
 */
export function SideChatToggle({ sessionId, useSideChat, claimHeaderSeat, open, t }: SideChatToggleProps) {
  const accelerator = useSideChat(state => state.accelerator)

  useLayoutEffect(() => claimHeaderSeat(sessionId), [sessionId, claimHeaderSeat])

  return <Summon accelerator={accelerator} open={open} t={t} />
}

/**
 * Render the same icon in the utility row's own place, but only while that row
 * is not showing it — a blank conversation, or Code mode holding the column.
 *
 * A floating strip, not a second row: it takes the corner the utility row
 * occupies, inset by the header's own padding and at the same height, so the
 * icon lands on the pixels it will keep once the header returns. Where exactly
 * that is depends on what else is already holding the corner — see
 * [header-anchor](./header-anchor.ts).
 * @param props - composed slot props (contract.ts).
 * @returns the button over the row's place, or null whenever the header has it.
 */
export function OverlayToggle({ useSessions, useSideChat, useHeaderSeats, open, t }: OverlayToggleProps) {
  const sessionId = useSessions(state => state.current)
  const accelerator = useSideChat(state => state.accelerator)
  const seated = useHeaderSeats(seats => isSeated(seats, sessionId))
  // The seat report is also the re-measure signal: the centre column keeps its
  // exact geometry when Code mode takes it, so no resize says the corner
  // changed — but this does, at exactly that moment.
  const anchor = useHeaderAnchor(`${String(sessionId)}:${String(seated)}`)

  // No anchor is a page with no conversation column to sit in — the workspace
  // picker, where there is no header row to stand in for either.
  if (seated || anchor === undefined) return null

  return (
    // The attribute is how the corner measurement excludes this strip from the
    // furniture it places itself against — without it the icon would shuffle
    // left by its own width on every re-measure.
    <div
      className={css.headerStrip}
      style={{ top: anchor.top, right: anchor.right, height: HEADER_ROW_HEIGHT }}
      {...{ [STRIP_ATTRIBUTE]: '' }}
    >
      <Summon accelerator={accelerator} open={open} t={t} />
    </div>
  )
}
