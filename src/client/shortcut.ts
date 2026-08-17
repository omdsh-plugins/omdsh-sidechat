/**
 * The keybinding switchboard, as this plugin reads it — and the handover this
 * plugin performs when one is present.
 *
 * ## The protocol
 *
 * This plugin binds `⌘L` itself, because a plugin that summons a panel is
 * useless without a way to summon it and cannot assume anybody else will
 * provide one. But a composition WITH a keybinding layer should have exactly
 * one place where keys are decided, and two listeners racing for one chord is
 * the failure that place exists to prevent. So when `shortcut` is present this
 * plugin gives the key up — `setSummonChord(null)` — and registers a command
 * instead. One handler, one press, and the chord becomes a row in a settings
 * form like every other.
 *
 * ## Why the tooltip is part of it
 *
 * Giving the key up must not mean forgetting what it is. The toggle's tooltip
 * teaches the chord, and a tooltip that stops naming one — or worse, keeps
 * naming the old one after a rebinding — is a regression the handover would
 * otherwise cause. So the handover reads the chord back out of the switchboard
 * and keeps reading it: `onBindings` fires on every revision, which is what
 * makes a rebinding in the settings panel reach the tooltip with no reload.
 *
 * Structural mirror rather than an import, for the reason `omdsh-codemode`
 * mirrors the mode registry: cordis binds services by name at runtime, and a
 * cross-plugin value import is a client-bundle purity error.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/shortcut
 */

/** Service name the switchboard is published under in the browser. */
export const SHORTCUT_SERVICE = 'shortcut'

/** Command id the summon answers to once the key has been given up. */
export const SUMMON_COMMAND = 'sidechat.open'

/** Who holds the chord that reaches one command on this surface. */
export type ChordClaim =
  | { holder: 'native'; accelerator: string }
  | { holder: 'page'; accelerator: string }
  | { holder: 'none' }
  | { holder: 'unreachable'; accelerator: string }

/** One command as the switchboard reports it here. */
export interface ShortcutBinding {
  command: string
  label: string
  claim: ChordClaim
  handled: boolean
}

/** As much of the browser-side switchboard as this plugin uses. */
export interface IShortcutClient {
  /**
   * Perform one `browser` command in this page.
   * @param command - the item id.
   * @param handler - what the press runs.
   * @returns the deregistration.
   */
  register: (command: string, handler: () => void) => () => void
  /** Every command the current document declares, as it stands here. */
  bindings: () => ShortcutBinding[]
  /**
   * Watch for the document changing.
   * @param listener - called after each revision.
   * @returns unsubscribe.
   */
  onBindings: (listener: () => void) => () => void
}

/**
 * The chord that reaches the summon on this surface, for display.
 *
 * `native` counts as much as `page`: on the desktop the menu holds the chord
 * and the page never hears it, but the person still presses the same keys, and
 * a tooltip that went blank there would be teaching a falsehood by omission.
 * `unreachable` and `none` both answer undefined — one is a key a tab is never
 * handed and the other is no key at all, and neither is something to name.
 * @param bindings - the switchboard's report.
 * @returns the accelerator to display, or undefined when there is none here.
 */
export function summonChordFrom(bindings: readonly ShortcutBinding[]): string | undefined {
  const claim = bindings.find(binding => binding.command === SUMMON_COMMAND)?.claim
  if (claim === undefined) return undefined
  return claim.holder === 'native' || claim.holder === 'page' ? claim.accelerator : undefined
}
