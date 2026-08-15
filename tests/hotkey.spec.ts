// @vitest-environment jsdom
/**
 * A global key listener is the most likely thing in this package to become
 * somebody else's bug. These are the rules that keep it from being one, and
 * the negative cases matter more than the positive one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chord } from '../src/client/chord.ts'
import { DEFAULT_SUMMON_ACCELERATOR, parseAccelerator } from '../src/client/chord.ts'
import { installHotkey, isEditingTarget } from '../src/client/hotkey.ts'

/** A keydown as the browser would deliver it, from a given element. */
function press(from: Element, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  from.dispatchEvent(event)
  return event
}

/** The default chord, as the plugin binds it at mount. */
const DEFAULT_CHORD = parseAccelerator(DEFAULT_SUMMON_ACCELERATOR)

let dispose: () => void = () => {}
let handlers: { isOpen: () => boolean; open: () => void; close: () => void }
let open = false
let chord: Chord | undefined

beforeEach(() => {
  document.body.innerHTML = ''
  open = false
  chord = DEFAULT_CHORD
  handlers = {
    isOpen: () => open,
    open: vi.fn(() => { open = true }),
    close: vi.fn(() => { open = false }),
  }
  dispose = installHotkey(window, handlers, () => chord)
})

afterEach(() => { dispose() })

describe('isEditingTarget', () => {
  it('yields inside text entry', () => {
    document.body.innerHTML = '<textarea id="t"></textarea><input id="i"><div id="c" contenteditable="true"></div>'

    for (const id of ['t', 'i', 'c']) expect(isEditingTarget(document.getElementById(id))).toBe(true)
  })

  it('yields inside a surface that claimed the key', () => {
    document.body.innerHTML = '<div data-omdsh-sidechat-yield><span id="s">terminal</span></div>'

    expect(isEditingTarget(document.getElementById('s'))).toBe(true)
  })

  it('does not yield inside this plugin\'s own box', () => {
    // Otherwise the key would be one-way: it could open the box and never
    // close it, because the focus it moved is inside a textarea.
    document.body.innerHTML = '<div data-omdsh-sidechat><textarea id="t"></textarea></div>'

    expect(isEditingTarget(document.getElementById('t'))).toBe(false)
  })

  it('does not yield over ordinary content', () => {
    document.body.innerHTML = '<div id="d">text</div>'

    expect(isEditingTarget(document.getElementById('d'))).toBe(false)
  })
})

describe('installHotkey', () => {
  it('summons from ordinary content', () => {
    document.body.innerHTML = '<div id="d">text</div>'

    const event = press(document.getElementById('d')!, 'l', { metaKey: true })

    expect(handlers.open).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the chord completely alone inside text', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>'

    const event = press(document.getElementById('t')!, 'l', { metaKey: true })

    expect(handlers.open).not.toHaveBeenCalled()
    // Not merely un-handled: un-PREVENTED, so the surface's own binding runs.
    expect(event.defaultPrevented).toBe(false)
  })

  it('toggles shut from inside its own box', () => {
    open = true
    document.body.innerHTML = '<div data-omdsh-sidechat><textarea id="t"></textarea></div>'

    press(document.getElementById('t')!, 'l', { metaKey: true })

    expect(handlers.close).toHaveBeenCalledOnce()
  })

  it('closes on Escape without consuming it', () => {
    open = true
    document.body.innerHTML = '<div id="d">text</div>'

    const event = press(document.getElementById('d')!, 'Escape')

    expect(handlers.close).toHaveBeenCalledOnce()
    // The harness's Menu and Modal listen for Escape too; one press dismissing
    // every transient thing on screen is the behaviour people expect.
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores Escape while closed', () => {
    document.body.innerHTML = '<div id="d">text</div>'

    press(document.getElementById('d')!, 'Escape')

    expect(handlers.close).not.toHaveBeenCalled()
  })

  it('consumes nothing else', () => {
    document.body.innerHTML = '<div id="d">text</div>'

    // 'k' is in this list deliberately: it was the summon chord once, and
    // leaving a released key half-taken is how a rebinding goes wrong.
    for (const key of ['k', 'j', 'a', 'Enter']) {
      expect(press(document.getElementById('d')!, key, { metaKey: true }).defaultPrevented).toBe(false)
    }
    expect(handlers.open).not.toHaveBeenCalled()
  })

  it('stops listening once disposed', () => {
    document.body.innerHTML = '<div id="d">text</div>'
    dispose()

    press(document.getElementById('d')!, 'l', { metaKey: true })

    expect(handlers.open).not.toHaveBeenCalled()
  })
})

describe('rebinding', () => {
  it('answers to the new chord on the very next keystroke', () => {
    document.body.innerHTML = '<div id="d">text</div>'
    // Read through a thunk on every event, so no listener is torn down.
    chord = parseAccelerator('CmdOrCtrl+Shift+K')

    press(document.getElementById('d')!, 'K', { metaKey: true, shiftKey: true })

    expect(handlers.open).toHaveBeenCalledOnce()
  })

  it('releases the old chord completely when rebound', () => {
    document.body.innerHTML = '<div id="d">text</div>'
    chord = parseAccelerator('CmdOrCtrl+Shift+K')

    const event = press(document.getElementById('d')!, 'l', { metaKey: true })

    expect(handlers.open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('consumes nothing at all while unbound', () => {
    // How another plugin says "I own this key now". A second handler racing a
    // native menu item is exactly what this has to avoid.
    document.body.innerHTML = '<div id="d">text</div>'
    chord = undefined

    const event = press(document.getElementById('d')!, 'l', { metaKey: true })

    expect(handlers.open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not even toggle shut while unbound', () => {
    open = true
    document.body.innerHTML = '<div data-omdsh-sidechat><textarea id="t"></textarea></div>'
    chord = undefined

    press(document.getElementById('t')!, 'l', { metaKey: true })

    expect(handlers.close).not.toHaveBeenCalled()
  })

  it('still closes on Escape while unbound, so nothing can get stuck', () => {
    open = true
    document.body.innerHTML = '<div id="d">text</div>'
    chord = undefined

    press(document.getElementById('d')!, 'Escape')

    expect(handlers.close).toHaveBeenCalledOnce()
  })
})
