/**
 * Anchor plus question, turned into the one thing the wire accepts.
 *
 * `PromptContentPart` is `text` or `image` and nothing else, so an anchor
 * cannot travel as structure — it travels as a PREFIX, and the honest response
 * to that is to make the prefix the shape a person would have typed by hand:
 * a path with a line range, the quoted lines under it, then the question.
 *
 * Two rules do most of the work here:
 *
 *   - **paths go in relative to the conversation's working directory**,
 *     because that is the form the agent can act on — an absolute path is
 *     something it has to translate before it can open anything;
 *   - **a quotation is clamped, never streamed**. Past
 *     {@link MAX_EXCERPT_LINES} the middle is dropped and past
 *     {@link MAX_EXCERPT_BYTES} the tail is cut, and both say so in the text.
 *     The point of this surface is to ask one question about one place; a
 *     surface that will paste a whole file into the context on a stray ⌘A is a
 *     different and worse tool.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/compose
 */

import type { PromptContentPart } from '@deepseek-ai/dsh-api-remotes/client'
import type { Anchor } from './anchor.ts'

/** Longest quotation kept whole, in lines; beyond it the middle is elided. */
export const MAX_EXCERPT_LINES = 60
/** Hard size ceiling of a quotation, in UTF-8 bytes, applied after the line clamp. */
export const MAX_EXCERPT_BYTES = 4096

/** Lines kept from the head of an elided quotation. */
const HEAD_LINES = 30
/** Lines kept from its tail; head + tail + the marker line make {@link MAX_EXCERPT_LINES}. */
const TAIL_LINES = MAX_EXCERPT_LINES - HEAD_LINES - 1

/**
 * Encoder for the byte clamp. One instance: it is stateless and constructing
 * one per line is pure waste.
 */
const encoder = new TextEncoder()

/** A clamped quotation and what had to be dropped to get there. */
export interface ClampedExcerpt {
  /** The text as it will appear in the prompt, markers included. */
  readonly text: string
  /** Lines elided from the middle; 0 when the quotation fit. */
  readonly omitted: number
  /** True when the byte ceiling cut the tail. */
  readonly clipped: boolean
}

/**
 * Resolve a surface-published path into the form the agent can act on.
 *
 * A path under the conversation's working directory becomes relative to it;
 * anything else — a sibling checkout, a path published by a surface that knows
 * nothing about cwd — is returned untouched, because a wrong relative path is
 * worse than an honest absolute one.
 * @param path - the path as the surface published it.
 * @param cwd - the conversation's working directory, when it has one.
 * @returns the path as it should appear in the prompt.
 */
export function relativePath(path: string, cwd?: string): string {
  const clean = path.replace(/^\.[/\\]/, '')
  if (cwd === undefined || cwd === '') return clean
  const root = cwd.replace(/[/\\]+$/, '')
  if (!clean.startsWith(root)) return clean
  const rest = clean.slice(root.length).replace(/^[/\\]+/, '')
  // The path IS the working directory: naming it '' would read as "no path".
  return rest === '' ? clean : rest
}

/** Whether a path is already rooted. */
function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Resolve an anchored path for the conversation that will receive it.
 *
 * Two directories are in play and they are usually NOT the same one. The
 * anchor comes from the workspace you are looking at; the side conversation
 * lives in the Chat workspace. So the path is rooted against where it came
 * from, and only then made relative to where it is going — which means it
 * comes out relative when both are the same directory and absolute when they
 * are not, without either case being special-cased.
 *
 * An absolute path the receiver cannot shorten is the correct answer, not a
 * degraded one: it is the only form that still names the right file.
 * @param path - the path as the surface published it.
 * @param source - working directory the anchor came from.
 * @param target - working directory of the receiving conversation.
 * @returns the path as it should appear in the prompt.
 */
export function resolveAnchorPath(path: string, source?: string, target?: string): string {
  const clean = path.replace(/^\.[/\\]/, '')
  const rooted = isAbsolute(clean) || source === undefined || source === ''
    ? clean
    : `${source.replace(/[/\\]+$/, '')}/${clean}`
  return relativePath(rooted, target)
}

/**
 * The location line: what a person would write to point at this place.
 * @param anchor - the resolved anchor.
 * @param source - working directory the anchor came from.
 * @param target - working directory of the receiving conversation.
 * @returns `path`, `path:12`, or `path:12-30`; undefined when unlocated.
 */
export function anchorLabel(anchor: Anchor, source?: string, target?: string): string | undefined {
  if (anchor.path === undefined) return undefined
  const path = resolveAnchorPath(anchor.path, source, target)
  if (anchor.range === undefined) return path
  const [first, last] = anchor.range
  return first === last ? `${path}:${String(first)}` : `${path}:${String(first)}-${String(last)}`
}

/**
 * Clamp a quotation to something worth sending.
 *
 * The markers are English regardless of the interface language: they are read
 * by the agent, not by the person, and the prompt is not the place to make the
 * model guess whether a Chinese sentence is instruction or content.
 * @param text - the selected text, verbatim.
 * @returns the clamped text and what it lost (see {@link ClampedExcerpt}).
 */
export function clampExcerpt(text: string): ClampedExcerpt {
  const lines = text.split('\n')
  let omitted = 0
  let kept = lines
  if (lines.length > MAX_EXCERPT_LINES) {
    omitted = lines.length - HEAD_LINES - TAIL_LINES
    kept = [
      ...lines.slice(0, HEAD_LINES),
      `… ${String(omitted)} lines omitted …`,
      ...lines.slice(lines.length - TAIL_LINES),
    ]
  }

  const out: string[] = []
  let bytes = 0
  let clipped = false
  for (const line of kept) {
    const size = encoder.encode(line).length + 1
    if (bytes + size > MAX_EXCERPT_BYTES) {
      // One line can exceed the whole budget on its own (a minified file, a
      // long log record). Keep the front of it rather than nothing.
      const room = MAX_EXCERPT_BYTES - bytes
      if (room > 16 && out.length === 0) out.push(line.slice(0, room))
      clipped = true
      break
    }
    out.push(line)
    bytes += size
  }
  if (clipped) out.push('… truncated …')

  return { text: out.join('\n'), omitted, clipped }
}

/**
 * The longest run of backticks in a text, so a fence can be chosen that the
 * quotation cannot break out of.
 * @param text - the quotation.
 * @returns the fence, at least three backticks.
 */
export function fenceFor(text: string): string {
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * The fence info string: the file's extension, used verbatim.
 *
 * No extension table. An extension that happens to be a language tag lights up
 * highlighting, one that does not is inert, and neither outcome is worth a
 * mapping this package would then have to maintain.
 * @param path - the anchored path, when there is one.
 * @returns the info string, empty when there is nothing to say.
 */
export function languageOf(path: string | undefined): string {
  if (path === undefined) return ''
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]
  return extension === undefined ? '' : extension.toLowerCase()
}

/** The two working directories a composition sits between. */
export interface ComposeScope {
  /** Where the anchor came from — the conversation you are looking at. */
  source?: string
  /** Where the question is going — the side conversation. */
  target?: string
}

/**
 * Assemble the prompt text: location, quotation, question.
 * @param anchor - where the question was asked from.
 * @param question - what was typed, already trimmed by the caller.
 * @param scope - the two working directories (see {@link ComposeScope}).
 * @returns the text exactly as it will be submitted.
 */
export function composeText(anchor: Anchor, question: string, scope: ComposeScope = {}): string {
  const label = anchorLabel(anchor, scope.source, scope.target)
  const excerpt = anchor.excerpt === undefined ? undefined : clampExcerpt(anchor.excerpt)
  if (label === undefined && excerpt === undefined) return question

  const parts: string[] = []
  if (label !== undefined) parts.push(label)
  if (excerpt !== undefined) {
    const fence = fenceFor(excerpt.text)
    parts.push(`${fence}${languageOf(anchor.path)}\n${excerpt.text}\n${fence}`)
  }
  parts.push(question)
  return parts.join('\n\n')
}

/**
 * The submitted content: one text part, always.
 *
 * Images are a composer capability and stay one — this surface takes a line of
 * text about a place, and a second attachment pipeline here would be a second
 * composer wearing a small hat.
 * @param anchor - where the question was asked from.
 * @param question - what was typed.
 * @param scope - the two working directories (see {@link ComposeScope}).
 * @returns the wire content.
 */
export function composePrompt(anchor: Anchor, question: string, scope: ComposeScope = {}): PromptContentPart[] {
  return [{ type: 'text', text: composeText(anchor, question, scope) }]
}
