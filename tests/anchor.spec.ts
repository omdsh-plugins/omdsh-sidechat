// @vitest-environment jsdom
/**
 * Anchor resolution: the published attributes, the degradations between them,
 * and the order of the roster.
 *
 * The Selection is a stub over a REAL Range. jsdom's own text extraction is
 * not the thing under test here — the attribute walk and the line arithmetic
 * are — and a stub makes the quotation an input rather than a hope.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AnchorRegistry, NO_ANCHOR, hasLocation } from '../src/client/anchor.ts'
import { keepSelection, selectionAnchor, selectionRect } from '../src/client/dom-anchor.ts'

/** An all-zero box: what a caret in a hidden subtree reports in a real browser. */
const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect

/**
 * Build a Selection over the given nodes, reporting the given text.
 *
 * The rect is stubbed onto the Range because jsdom implements no layout and
 * therefore no `Range.getBoundingClientRect` at all. Every browser has it, so
 * the production code does not guard for its absence; the spec supplies it.
 */
function selectionOver(start: Node, end: Node, text: string, endOffset = 0, rect: DOMRect = ZERO_RECT): Selection {
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, endOffset)
  Object.assign(range, { getBoundingClientRect: () => rect })
  return {
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => text,
  } as unknown as Selection
}

/** The row element carrying a line number. */
function row(line: number, text: string): string {
  return `<div data-omdsh-anchor-line="${String(line)}">${text}</div>`
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('selectionAnchor', () => {
  it('reads path, line range and quotation from one selection', () => {
    document.body.innerHTML = `
      <section data-omdsh-anchor="src/client/apply.ts">
        ${row(199, 'children: {')}
        ${row(200, "'conversation.view': {},")}
      </section>`
    const rows = document.querySelectorAll('[data-omdsh-anchor-line]')

    const anchor = selectionAnchor(selectionOver(rows[0]!, rows[1]!, "children: {\n'conversation.view': {},", 1))

    expect(anchor).toEqual({
      origin: 'selection',
      path: 'src/client/apply.ts',
      range: [199, 200],
      excerpt: "children: {\n'conversation.view': {},",
    })
  })

  it('yields a quotation with no coordinates when nothing published them', () => {
    document.body.innerHTML = '<p id="p">some prose</p>'
    const paragraph = document.getElementById('p')!

    expect(selectionAnchor(selectionOver(paragraph, paragraph, 'some prose'))).toEqual({
      origin: 'selection',
      excerpt: 'some prose',
    })
  })

  it('yields a path with no range on a surface with no line structure', () => {
    document.body.innerHTML = '<div data-omdsh-anchor="docs/readme.md"><p id="p">text</p></div>'
    const paragraph = document.getElementById('p')!

    expect(selectionAnchor(selectionOver(paragraph, paragraph, 'text'))).toEqual({
      origin: 'selection',
      path: 'docs/readme.md',
      excerpt: 'text',
    })
  })

  it('names the surface under a collapsed caret without quoting it', () => {
    document.body.innerHTML = `<section data-omdsh-anchor="src/a.ts">${row(7, 'x')}</section>`
    const line = document.querySelector('[data-omdsh-anchor-line]')!

    expect(selectionAnchor(selectionOver(line, line, ''))).toEqual({
      origin: 'element',
      path: 'src/a.ts',
      range: [7, 7],
    })
  })

  it('has nothing to say about a collapsed caret over an anonymous surface', () => {
    document.body.innerHTML = '<p id="p">text</p>'
    const paragraph = document.getElementById('p')!

    expect(selectionAnchor(selectionOver(paragraph, paragraph, ''))).toBeUndefined()
  })

  it('does not quote the draft back into its own prompt', () => {
    document.body.innerHTML = '<div data-omdsh-sidechat><textarea id="t">draft</textarea></div>'
    const draft = document.getElementById('t')!

    expect(selectionAnchor(selectionOver(draft, draft, 'draft'))).toBeUndefined()
  })

  it('drops a trailing row the drag never actually covered', () => {
    document.body.innerHTML = `
      <section data-omdsh-anchor="src/a.ts">
        ${row(4, 'first')}
        ${row(5, 'second')}
      </section>`
    const rows = document.querySelectorAll('[data-omdsh-anchor-line]')

    // Dragging to the very start of row 5 selects nothing on it.
    const anchor = selectionAnchor(selectionOver(rows[0]!, rows[1]!, 'first', 0))

    expect(anchor?.range).toEqual([4, 4])
  })

  it('has nothing to say without a selection at all', () => {
    expect(selectionAnchor(null)).toBeUndefined()
  })
})

describe('selectionRect', () => {
  it('reports the selection\'s own box', () => {
    document.body.innerHTML = '<p id="p">text</p>'
    const paragraph = document.getElementById('p')!
    const measured = { left: 40, top: 60, right: 240, bottom: 80, width: 200, height: 20 } as DOMRect

    expect(selectionRect(selectionOver(paragraph, paragraph, 'text', 0, measured))).toBe(measured)
  })

  it('declines a zero box rather than pinning the overlay to the corner', () => {
    document.body.innerHTML = '<p id="p">text</p>'
    const paragraph = document.getElementById('p')!

    // What a caret inside a hidden subtree reports; placing the box at 0,0 for
    // it would put it in the corner of the screen for no reason.
    expect(selectionRect(selectionOver(paragraph, paragraph, 'text'))).toBeUndefined()
  })

  it('declines when there is no selection', () => {
    expect(selectionRect(null)).toBeUndefined()
  })
})

describe('keepSelection', () => {
  it('prevents the default so a click cannot collapse the anchor', () => {
    // Without this the header icon would open the box anchored to nothing,
    // every time: pressing a button collapses the selection and moves focus
    // before the click handler ever runs.
    const event = new MouseEvent('pointerdown', { cancelable: true })

    keepSelection(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('AnchorRegistry', () => {
  const builtin = { origin: 'none' as const, path: 'builtin' }
  const registry = (): AnchorRegistry => new AnchorRegistry([() => builtin])

  it('falls back to the built-in reading when nobody registered', () => {
    expect(registry().resolve()).toEqual(builtin)
  })

  it('prefers the newest registration', () => {
    const roster = registry()
    roster.register(() => ({ origin: 'element', path: 'first' }))
    roster.register(() => ({ origin: 'element', path: 'second' }))

    expect(roster.resolve().path).toBe('second')
  })

  it('passes the question on when a source has nothing to say', () => {
    const roster = registry()
    roster.register(() => ({ origin: 'element', path: 'first' }))
    roster.register(() => undefined)

    expect(roster.resolve().path).toBe('first')
  })

  it('skips a throwing source instead of failing the summon', () => {
    const roster = registry()
    roster.register(() => { throw new Error('panel is mid-teardown') })

    expect(roster.resolve()).toEqual(builtin)
  })

  it('removes a registration through its disposer', () => {
    const roster = registry()
    const dispose = roster.register(() => ({ origin: 'element', path: 'temporary' }))
    dispose()

    expect(roster.resolve()).toEqual(builtin)
  })

  it('answers with no anchor when even the built-ins decline', () => {
    expect(new AnchorRegistry([]).resolve()).toBe(NO_ANCHOR)
  })
})

describe('hasLocation', () => {
  it('separates an anchor worth drawing from one that is not', () => {
    expect(hasLocation(NO_ANCHOR)).toBe(false)
    expect(hasLocation({ origin: 'element', path: 'src/a.ts' })).toBe(true)
    expect(hasLocation({ origin: 'selection', excerpt: 'x' })).toBe(true)
  })
})
