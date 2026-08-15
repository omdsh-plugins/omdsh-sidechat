/**
 * The prompt text is the whole product of this plugin: what the agent receives
 * is a string, and every rule about paths and clamping only exists in the
 * shape of that string.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_EXCERPT_BYTES, MAX_EXCERPT_LINES,
  anchorLabel, clampExcerpt, composeText, fenceFor, languageOf, relativePath, resolveAnchorPath,
} from '../src/client/compose.ts'
import type { Anchor } from '../src/client/anchor.ts'

describe('relativePath', () => {
  it('relativizes a path under the working directory', () => {
    expect(relativePath('/w/proj/src/a.ts', '/w/proj')).toBe('src/a.ts')
  })

  it('tolerates a trailing separator on the working directory', () => {
    expect(relativePath('/w/proj/src/a.ts', '/w/proj/')).toBe('src/a.ts')
  })

  it('leaves a path outside the working directory absolute', () => {
    // A wrong relative path sends the agent somewhere real and wrong; an
    // absolute one merely costs it a translation.
    expect(relativePath('/elsewhere/a.ts', '/w/proj')).toBe('/elsewhere/a.ts')
  })

  it('leaves a sibling whose name merely starts with it absolute', () => {
    // A string prefix is not a parent directory. Slicing one off here would
    // produce `-server/src/a.ts`: a relative path that resolves to nothing,
    // and one nobody reading the prompt would recognize as wrong.
    expect(relativePath('/home/me/code/app-server/src/a.ts', '/home/me/code/app'))
      .toBe('/home/me/code/app-server/src/a.ts')
  })

  it('leaves the working directory itself alone rather than emptying it', () => {
    expect(relativePath('/w/proj', '/w/proj')).toBe('/w/proj')
  })

  it('passes a path through unchanged when there is no working directory', () => {
    expect(relativePath('./src/a.ts')).toBe('src/a.ts')
  })
})

describe('resolveAnchorPath', () => {
  it('relativizes when the anchor and the receiver share a directory', () => {
    expect(resolveAnchorPath('/w/proj/src/a.ts', '/w/proj', '/w/proj')).toBe('src/a.ts')
  })

  it('stays absolute when the side conversation lives somewhere else', () => {
    // The Chat workspace is the normal case, not an edge one: a relative path
    // there names a file that is not there.
    expect(resolveAnchorPath('/w/proj/src/a.ts', '/w/proj', '/home/me/.dsh/chat'))
      .toBe('/w/proj/src/a.ts')
  })

  it('roots a surface-relative path against where it came from', () => {
    expect(resolveAnchorPath('src/a.ts', '/w/proj', '/home/me/.dsh/chat')).toBe('/w/proj/src/a.ts')
    expect(resolveAnchorPath('./src/a.ts', '/w/proj/', '/home/me/.dsh/chat')).toBe('/w/proj/src/a.ts')
  })

  it('leaves a relative path alone when nothing says what it is relative to', () => {
    expect(resolveAnchorPath('src/a.ts')).toBe('src/a.ts')
  })

  it('recognizes a rooted Windows path', () => {
    expect(resolveAnchorPath('C:\\w\\proj\\a.ts', '/w/proj', '/chat')).toBe('C:\\w\\proj\\a.ts')
  })
})

describe('anchorLabel', () => {
  const at = (range?: readonly [number, number]): Anchor =>
    ({ origin: 'selection', path: '/w/proj/src/a.ts', ...(range === undefined ? {} : { range }) })

  it('names a range', () => {
    expect(anchorLabel(at([12, 30]), '/w/proj', '/w/proj')).toBe('src/a.ts:12-30')
  })

  it('collapses a single-line range', () => {
    expect(anchorLabel(at([12, 12]), '/w/proj', '/w/proj')).toBe('src/a.ts:12')
  })

  it('omits lines a surface never published', () => {
    expect(anchorLabel(at(), '/w/proj', '/w/proj')).toBe('src/a.ts')
  })

  it('shows the absolute path when the receiver is in another workspace', () => {
    expect(anchorLabel(at([12, 30]), '/w/proj', '/chat')).toBe('/w/proj/src/a.ts:12-30')
  })

  it('has nothing to say without a path', () => {
    expect(anchorLabel({ origin: 'selection', excerpt: 'x' }, '/w/proj', '/w/proj')).toBeUndefined()
  })
})

describe('clampExcerpt', () => {
  it('keeps a short quotation whole', () => {
    const result = clampExcerpt('one\ntwo')
    expect(result).toEqual({ text: 'one\ntwo', omitted: 0, clipped: false })
  })

  it('drops the middle of a long one and says how much', () => {
    const source = Array.from({ length: 200 }, (_, index) => `line ${String(index + 1)}`).join('\n')
    const result = clampExcerpt(source)
    const lines = result.text.split('\n')

    expect(lines).toHaveLength(MAX_EXCERPT_LINES)
    expect(lines[0]).toBe('line 1')
    expect(lines.at(-1)).toBe('line 200')
    expect(result.omitted).toBe(200 - (MAX_EXCERPT_LINES - 1))
    expect(result.text).toContain(`… ${String(result.omitted)} lines omitted …`)
  })

  it('cuts the tail once the byte ceiling is reached', () => {
    // Few lines, far too many bytes: the line clamp cannot help here.
    const result = clampExcerpt(Array.from({ length: 4 }, () => 'x'.repeat(2000)).join('\n'))

    expect(result.clipped).toBe(true)
    expect(result.text).toContain('… truncated …')
    expect(new TextEncoder().encode(result.text).length).toBeLessThan(MAX_EXCERPT_BYTES + 64)
  })

  it('keeps the front of a single line longer than the whole budget', () => {
    const result = clampExcerpt('y'.repeat(MAX_EXCERPT_BYTES * 3))

    expect(result.clipped).toBe(true)
    expect(result.text.startsWith('yyy')).toBe(true)
  })
})

describe('fenceFor', () => {
  it('opens with three backticks by default', () => {
    expect(fenceFor('plain')).toBe('```')
  })

  it('outgrows any run the quotation contains', () => {
    // Otherwise the quotation closes the fence early and the rest of the
    // prompt is read as prose.
    expect(fenceFor('a ``` b')).toBe('````')
    expect(fenceFor('a ````` b')).toBe('``````')
  })
})

describe('languageOf', () => {
  it('uses the extension verbatim', () => {
    expect(languageOf('src/a.TSX')).toBe('tsx')
  })

  it('says nothing about a path with no extension', () => {
    expect(languageOf('Makefile')).toBe('')
    expect(languageOf(undefined)).toBe('')
  })
})

describe('composeText', () => {
  it('puts the location, the quotation and the question in that order', () => {
    const anchor: Anchor = {
      origin: 'selection',
      path: '/w/proj/src/a.ts',
      range: [2, 3],
      excerpt: 'const a = 1\nconst b = 2',
    }

    expect(composeText(anchor, 'why two?', { source: '/w/proj', target: '/w/proj' })).toBe(
      'src/a.ts:2-3\n\n```ts\nconst a = 1\nconst b = 2\n```\n\nwhy two?',
    )
  })

  it('sends a path with no quotation and lets the agent read it', () => {
    const anchor: Anchor = { origin: 'element', path: '/w/proj/src/a.ts' }

    expect(composeText(anchor, 'what is this?', { source: '/w/proj', target: '/w/proj' })).toBe('src/a.ts\n\nwhat is this?')
  })

  it('sends the question alone when nothing said where it came from', () => {
    expect(composeText({ origin: 'none' }, 'status?')).toBe('status?')
  })
})
