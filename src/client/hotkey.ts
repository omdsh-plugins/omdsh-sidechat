/**
 * The summon key, and the discipline a global key listener owes the app it
 * lives in.
 *
 * The harness publishes no keybinding registry — `ui-commands` is the contract
 * for slash commands, not for keys — so this plugin installs its own listener
 * on the window. That makes it the single most likely thing here to turn into
 * somebody else's bug, and the rules below exist to make sure it does not:
 *
 *   - **it takes one bound chord and nothing else** (plus Escape, and only
 *     while open). Which chord is not decided here — see [chord](./chord.ts)
 *     and `ISideChat.setSummonChord`;
 *   - **it yields inside text**: an input, a textarea, a contenteditable, or
 *     any subtree flying {@link SIDECHAT_YIELD_ATTR}. There the event is not
 *     consumed and not prevented — the surface's own binding runs exactly as
 *     it would if this plugin were absent. A terminal keeps its clear-screen;
 *     a person already typing in the composer does not need a second box;
 *   - **it consumes nothing while closed.** Every path that declines also
 *     declines to `preventDefault`, so an unhandled chord reaches the browser
 *     — which for the default ⌘L means the address bar, the one place a
 *     person can always get back to;
 *   - **it consumes nothing at all while unbound.** A chord of `undefined` is
 *     how another plugin says "I own this key now" (a native menu item, for
 *     one), and the answer to that has to be complete silence rather than a
 *     second handler racing it;
 *   - **inside its own overlay it toggles**, because the yield rule would
 *     otherwise hand the key to this plugin's own textarea.
 *
 * Escape is deliberately NOT consumed: the harness's Menu and Modal listen for
 * it on the document, and one Escape dismissing every transient thing on
 * screen is both the platform convention and the behaviour a person expects.
 * It is also the reason an unbound chord leaves no way to get stuck — Escape
 * and the box's own ✕ close it regardless of what is bound.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/hotkey
 */

import { SIDECHAT_ROOT_ATTR, SIDECHAT_YIELD_ATTR } from '../conventions.ts'
import type { Chord } from './chord.ts'
import { matchesChord } from './chord.ts'

/** Surfaces that own their own keystrokes. */
const EDITING_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  `[${SIDECHAT_YIELD_ATTR}]`,
].join(', ')

/** What the listener drives; the panel supplies all three. */
export interface HotkeyHandlers {
  /** Whether the overlay is currently up. */
  isOpen: () => boolean
  /** Summon it. */
  open: () => void
  /** Dismiss it. */
  close: () => void
}

/**
 * Whether a surface owns its own keystrokes.
 *
 * This plugin's own overlay never does — the yield rule is about OTHER
 * people's text, and applying it to the draft textarea would make the key
 * one-way.
 * @param target - the event target.
 * @returns true when the key must be left alone.
 */
export function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(`[${SIDECHAT_ROOT_ATTR}]`) !== null) return false
  return target.closest(EDITING_SELECTOR) !== null
}

/**
 * Install the listener.
 *
 * Capture phase, so the chord is seen before an app-level handler can stop it
 * — the yield check above is what keeps that from being a land grab.
 *
 * The chord is read through a thunk on every event rather than captured at
 * install time, so a rebinding takes effect on the next keystroke and never
 * has to tear this listener down and put it back.
 * @param view - the window to listen on.
 * @param handlers - see {@link HotkeyHandlers}.
 * @param chordOf - the currently bound chord, or undefined while unbound.
 * @returns removal of the listener.
 */
export function installHotkey(view: Window, handlers: HotkeyHandlers, chordOf: () => Chord | undefined): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const open = handlers.isOpen()

    if (event.key === 'Escape') {
      // Not consumed: see the module note. Closing an overlay nobody can see
      // would also be wrong, hence the guard.
      if (open) handlers.close()
      return
    }

    const chord = chordOf()
    if (chord === undefined || !matchesChord(event, chord)) return

    if (open) {
      event.preventDefault()
      event.stopPropagation()
      handlers.close()
      return
    }
    if (isEditingTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    handlers.open()
  }

  view.addEventListener('keydown', onKeyDown, { capture: true })
  return () => { view.removeEventListener('keydown', onKeyDown, { capture: true }) }
}
