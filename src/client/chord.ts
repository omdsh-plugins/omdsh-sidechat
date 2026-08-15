/**
 * The summon chord as a value: parsed from an accelerator string, matched
 * against a keydown.
 *
 * The string vocabulary is **Electron's accelerator syntax**, deliberately —
 * it is what `omdsh-shortcuts`'s `MenuItem.accelerator` is already written in.
 * Picking the same words means a chord can move between the in-page listener
 * and a native menu item without a translation layer in between, and that
 * neither package has to learn the other's spelling.
 *
 * Only the subset a browser can observe is supported. Electron can claim
 * chords the page never sees (⌘Q, ⌘W); this parser accepts them syntactically
 * and the listener simply never matches, which is the honest outcome — the
 * page was never going to get that keydown.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/chord
 */

/** The chord this plugin binds when nobody has said otherwise. */
export const DEFAULT_SUMMON_ACCELERATOR = 'CmdOrCtrl+L'

/** A parsed accelerator. */
export interface Chord {
  /** The non-modifier key, normalized to `KeyboardEvent.key` in lower case. */
  key: string
  /** Requires Command / Super / Meta. */
  meta: boolean
  /** Requires Control. */
  ctrl: boolean
  /** Requires Alt / Option. */
  alt: boolean
  /** Requires Shift. */
  shift: boolean
  /**
   * Spelled `CmdOrCtrl`: satisfied by EXACTLY ONE of Command and Control.
   * Both held at once is a chord this plugin does not understand, and a
   * modifier it does not understand is not its event.
   */
  either: boolean
}

/**
 * Electron key names that differ from `KeyboardEvent.key`.
 *
 * `Plus` is in here because `+` is the separator and cannot be written
 * literally — the same reason Electron spells it out.
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  space: ' ',
  return: 'enter',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
}

/**
 * Parse an accelerator into a chord.
 *
 * Returns undefined rather than throwing: the caller (the service boundary)
 * owns the decision of how loud a bad accelerator should be, and it chooses to
 * be very loud — see `setSummonChord`.
 * @param accelerator - Electron accelerator syntax, e.g. `CmdOrCtrl+Shift+L`.
 * @returns the chord, or undefined when the string names none.
 */
export function parseAccelerator(accelerator: string): Chord | undefined {
  const tokens = accelerator.split('+').map(token => token.trim()).filter(token => token !== '')
  if (tokens.length === 0) return undefined

  const chord: Chord = { key: '', meta: false, ctrl: false, alt: false, shift: false, either: false }
  let key: string | undefined
  for (const token of tokens) {
    switch (token.toLowerCase()) {
      case 'command': case 'cmd': case 'super': case 'meta': chord.meta = true; break
      case 'control': case 'ctrl': chord.ctrl = true; break
      case 'commandorcontrol': case 'cmdorctrl': chord.either = true; break
      case 'alt': case 'option': chord.alt = true; break
      case 'shift': chord.shift = true; break
      default:
        // Two non-modifier tokens is not a chord anyone meant to write.
        if (key !== undefined) return undefined
        key = normalizeKey(token)
    }
  }
  if (key === undefined || key === '') return undefined
  // A bare key with no modifier would take a letter away from every text
  // surface that does not opt out. This plugin does not bind those.
  if (!chord.meta && !chord.ctrl && !chord.either && !chord.alt) return undefined
  return { ...chord, key }
}

/**
 * Whether a keydown is this chord.
 *
 * Every modifier is checked in both directions: a declared one must be held
 * and an undeclared one must not. That is what keeps ⌥⌘L from answering to a
 * ⌘L binding, generically, for whatever chord happens to be bound.
 * @param event - the keydown.
 * @param chord - the bound chord.
 * @returns true on an exact match.
 */
export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  if (normalizeKey(event.key) !== chord.key) return false
  if (event.altKey !== chord.alt) return false
  if (event.shiftKey !== chord.shift) return false
  if (chord.either) return event.metaKey !== event.ctrlKey
  return event.metaKey === chord.meta && event.ctrlKey === chord.ctrl
}

/**
 * Normalize a key name for comparison.
 * @param key - an Electron key name or a `KeyboardEvent.key`.
 * @returns the comparable form.
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/** How a key reads to a person, per platform. */
const KEY_LABELS: Readonly<Record<string, readonly [mac: string, other: string]>> = {
  ' ': ['Space', 'Space'],
  enter: ['↩', 'Enter'],
  escape: ['⎋', 'Esc'],
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
}

/**
 * Render an accelerator the way the platform writes it, for a tooltip.
 *
 * Display only — nothing parses this back. It exists so the icon in the header
 * can teach the chord: someone who found the feature with the mouse should be
 * able to stop using the mouse for it.
 * @param accelerator - Electron accelerator syntax.
 * @param mac - whether to use the Apple glyphs and their conventional order.
 * @returns the rendered chord, or undefined when the accelerator names none.
 */
export function formatAccelerator(accelerator: string, mac: boolean): string | undefined {
  const chord = parseAccelerator(accelerator)
  if (chord === undefined) return undefined

  const parts: string[] = []
  if (mac) {
    // The order Apple writes them in, regardless of the order they were typed.
    if (chord.ctrl) parts.push('⌃')
    if (chord.alt) parts.push('⌥')
    if (chord.shift) parts.push('⇧')
    if (chord.meta || chord.either) parts.push('⌘')
  } else {
    if (chord.ctrl || chord.either) parts.push('Ctrl')
    if (chord.meta) parts.push('Meta')
    if (chord.alt) parts.push('Alt')
    if (chord.shift) parts.push('Shift')
  }
  parts.push(KEY_LABELS[chord.key]?.[mac ? 0 : 1] ?? chord.key.toUpperCase())
  return parts.join(mac ? '' : '+')
}
