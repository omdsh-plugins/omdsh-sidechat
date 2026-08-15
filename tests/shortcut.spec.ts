/**
 * What the toggle's tooltip says once this plugin has given its key away.
 *
 * The handover is only half done if the chord stops being teachable. These are
 * the four states the switchboard can report a command in, and which of them a
 * person should be told about — the distinction that matters is between "you
 * press these keys" and "no key reaches this here", NOT between the two
 * mechanisms that deliver a press.
 */

import { describe, expect, it } from 'vitest'
import { SUMMON_COMMAND, summonChordFrom, type ShortcutBinding } from '../src/client/shortcut.ts'

/**
 * One reported binding.
 * @param claim - who holds the chord.
 * @param command - the command it belongs to.
 * @returns the binding.
 */
function report(claim: ShortcutBinding['claim'], command = SUMMON_COMMAND): ShortcutBinding {
  return { command, label: 'Ask Here', claim, handled: true }
}

describe('the chord the tooltip teaches', () => {
  it('names the chord a page binds', () => {
    expect(summonChordFrom([report({ holder: 'page', accelerator: 'CmdOrCtrl+Alt+L' })]))
      .toBe('CmdOrCtrl+Alt+L')
  })

  it('names a NATIVE chord too, because the person presses the same keys', () => {
    // On the desktop the menu claimed it before the page existed, so no
    // listener here will ever fire — and the keys still work. A tooltip that
    // went blank on the surface where the chord is MOST reliable would be
    // teaching a falsehood by omission.
    expect(summonChordFrom([report({ holder: 'native', accelerator: 'CmdOrCtrl+L' })]))
      .toBe('CmdOrCtrl+L')
  })

  it('teaches nothing for a chord this surface cannot be handed', () => {
    expect(summonChordFrom([report({ holder: 'unreachable', accelerator: 'CmdOrCtrl+W' })]))
      .toBeUndefined()
  })

  it('teaches nothing when the command has no chord at all', () => {
    expect(summonChordFrom([report({ holder: 'none' })])).toBeUndefined()
  })

  it('teaches nothing before the document has arrived', () => {
    // The stream lands after this plugin mounts, so an empty report is the
    // ordinary first read rather than a fault — the subscription fills it in.
    expect(summonChordFrom([])).toBeUndefined()
  })

  it('reads its own command and not a neighbour that happens to be bound', () => {
    expect(summonChordFrom([
      report({ holder: 'page', accelerator: 'CmdOrCtrl+K' }, 'session.new'),
      report({ holder: 'page', accelerator: 'CmdOrCtrl+Shift+E' }, 'panel.files'),
    ])).toBeUndefined()
  })
})
