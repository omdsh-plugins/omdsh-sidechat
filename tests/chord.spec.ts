// @vitest-environment jsdom
/**
 * The accelerator vocabulary is a contract with another package's menu
 * document, so the parser's job is to agree with Electron's spelling and to
 * reject anything it would bind wrongly rather than bind it anyway.
 *
 * jsdom only for `new KeyboardEvent`: the module itself reads four fields off
 * whatever it is handed and touches no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUMMON_ACCELERATOR, formatAccelerator, matchesChord, parseAccelerator,
} from '../src/client/chord.ts'

/** A keydown carrying exactly the given modifiers. */
function key(k: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, ...modifiers })
}

describe('parseAccelerator', () => {
  it('parses the default', () => {
    expect(parseAccelerator(DEFAULT_SUMMON_ACCELERATOR)).toEqual({
      key: 'l', meta: false, ctrl: false, alt: false, shift: false, either: true,
    })
  })

  it('accepts every spelling of a modifier Electron accepts', () => {
    for (const spelling of ['Command+L', 'Cmd+L', 'Super+L', 'Meta+L']) {
      expect(parseAccelerator(spelling)?.meta).toBe(true)
    }
    for (const spelling of ['Control+L', 'Ctrl+L']) {
      expect(parseAccelerator(spelling)?.ctrl).toBe(true)
    }
    for (const spelling of ['CommandOrControl+L', 'CmdOrCtrl+L']) {
      expect(parseAccelerator(spelling)?.either).toBe(true)
    }
    for (const spelling of ['Alt+L', 'Option+L']) {
      expect(parseAccelerator(spelling)?.alt).toBe(true)
    }
  })

  it('stacks modifiers and is not confused by case or spacing', () => {
    expect(parseAccelerator(' cmdorctrl + SHIFT + k ')).toEqual({
      key: 'k', meta: false, ctrl: false, alt: false, shift: true, either: true,
    })
  })

  it('translates the key names that differ from KeyboardEvent.key', () => {
    expect(parseAccelerator('CmdOrCtrl+Space')?.key).toBe(' ')
    expect(parseAccelerator('CmdOrCtrl+Return')?.key).toBe('enter')
    expect(parseAccelerator('CmdOrCtrl+Up')?.key).toBe('arrowup')
    // '+' cannot be written literally, since it is the separator.
    expect(parseAccelerator('CmdOrCtrl+Plus')?.key).toBe('+')
  })

  it('rejects a bare key with no modifier', () => {
    // It would take a letter away from every surface that does not opt out.
    expect(parseAccelerator('L')).toBeUndefined()
    expect(parseAccelerator('Shift+L')).toBeUndefined()
  })

  it('rejects a string that names no key', () => {
    expect(parseAccelerator('')).toBeUndefined()
    expect(parseAccelerator('CmdOrCtrl')).toBeUndefined()
    expect(parseAccelerator('+++')).toBeUndefined()
  })

  it('rejects two non-modifier tokens', () => {
    expect(parseAccelerator('CmdOrCtrl+K+L')).toBeUndefined()
  })
})

describe('matchesChord', () => {
  const cmdOrCtrlL = parseAccelerator('CmdOrCtrl+L')!

  it('accepts either of Command and Control', () => {
    expect(matchesChord(key('l', { metaKey: true }), cmdOrCtrlL)).toBe(true)
    expect(matchesChord(key('l', { ctrlKey: true }), cmdOrCtrlL)).toBe(true)
  })

  it('rejects both of them at once', () => {
    // A modifier combination this plugin does not understand is not its event.
    expect(matchesChord(key('l', { metaKey: true, ctrlKey: true }), cmdOrCtrlL)).toBe(false)
  })

  it('rejects an undeclared modifier', () => {
    expect(matchesChord(key('l', { metaKey: true, altKey: true }), cmdOrCtrlL)).toBe(false)
    expect(matchesChord(key('L', { metaKey: true, shiftKey: true }), cmdOrCtrlL)).toBe(false)
  })

  it('requires a declared modifier', () => {
    const withShift = parseAccelerator('CmdOrCtrl+Shift+L')!

    expect(matchesChord(key('L', { metaKey: true, shiftKey: true }), withShift)).toBe(true)
    expect(matchesChord(key('l', { metaKey: true }), withShift)).toBe(false)
  })

  it('is case-insensitive about the key the browser reports', () => {
    // Shift makes KeyboardEvent.key uppercase; a chord without Shift never
    // sees that, but a chord with one always does.
    expect(matchesChord(key('L', { ctrlKey: true }), cmdOrCtrlL)).toBe(true)
  })

  it('distinguishes a strict Command binding from a strict Control one', () => {
    const cmdOnly = parseAccelerator('Cmd+L')!

    expect(matchesChord(key('l', { metaKey: true }), cmdOnly)).toBe(true)
    expect(matchesChord(key('l', { ctrlKey: true }), cmdOnly)).toBe(false)
  })
})

describe('formatAccelerator', () => {
  it('writes the default the way each platform does', () => {
    expect(formatAccelerator(DEFAULT_SUMMON_ACCELERATOR, true)).toBe('⌘L')
    expect(formatAccelerator(DEFAULT_SUMMON_ACCELERATOR, false)).toBe('Ctrl+L')
  })

  it('uses Apple\'s modifier order, not the order they were typed', () => {
    expect(formatAccelerator('Shift+CmdOrCtrl+Alt+K', true)).toBe('⌥⇧⌘K')
  })

  it('spells modifiers out off the Mac', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+K', false)).toBe('Ctrl+Shift+K')
  })

  it('does not print Ctrl twice for a chord that names it both ways', () => {
    expect(formatAccelerator('CmdOrCtrl+Ctrl+K', false)).toBe('Ctrl+K')
  })

  it('names the keys that have no printable glyph', () => {
    expect(formatAccelerator('CmdOrCtrl+Space', true)).toBe('⌘Space')
    expect(formatAccelerator('CmdOrCtrl+Return', true)).toBe('⌘↩')
    expect(formatAccelerator('CmdOrCtrl+Up', false)).toBe('Ctrl+↑')
  })

  it('has nothing to show for an accelerator that names no chord', () => {
    expect(formatAccelerator('nonsense', true)).toBeUndefined()
  })
})
