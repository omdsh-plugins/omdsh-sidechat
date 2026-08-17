/**
 * What "where you asked from" is, and who gets to answer it.
 *
 * An anchor is a plain fact about a location — a path, maybe a line range,
 * maybe the text you had selected — and nothing else. It carries no rect, no
 * element and no session: placement is the overlay's business and delivery is
 * the session's, and keeping all three apart is what makes this file testable
 * without a browser.
 *
 * The roster exists so that a panel which knows more than the DOM does can say
 * so WITHOUT this package importing it. `omdsh-sidepanel`'s preview knows the
 * file it is showing; `omdsh-codemode`'s terminal knows its working directory.
 * Either could register a source here one day. Neither is imported, neither is
 * required, and with no registrations at all the built-in DOM reading is the
 * whole answer — see [dom-anchor](./dom-anchor.ts).
 * @module @omdsh-plugins/omdsh-sidechat/src/client/anchor
 */

/**
 * Where a question was asked from.
 *
 * Every field but `origin` is optional and independently so: a selection with
 * no path, a path with no lines, and a path with lines but no text are all
 * ordinary outcomes rather than degenerate ones.
 */
export interface Anchor {
  /**
   * How much of this anchor is real: `selection` when the person had text
   * selected, `element` when only the surrounding surface identified itself,
   * `none` when neither did.
   */
  readonly origin: 'selection' | 'element' | 'none'
  /** File or directory, as written by the surface; resolved against cwd later. */
  readonly path?: string
  /** 1-based inclusive line range, ordered. */
  readonly range?: readonly [number, number]
  /** The selected text, verbatim and unclamped; the composer decides what fits. */
  readonly excerpt?: string
}

/**
 * A contributor of anchors. Returning `undefined` means "I have nothing to say
 * about this moment" and passes the question on — it is not a failure, and it
 * is the correct answer for a panel the pointer is nowhere near.
 */
export type AnchorSource = () => Anchor | undefined

/** The anchor of a question asked from nowhere in particular. */
export const NO_ANCHOR: Anchor = { origin: 'none' }

/**
 * The anchor-source roster and the resolution order over it.
 *
 * Later registrations are asked FIRST: a plugin that mounts after this one is
 * more specific about its own surface than the generic DOM reading, and the
 * generic reading — passed in at construction — is the floor nobody can
 * remove.
 */
export class AnchorRegistry {
  private readonly sources: AnchorSource[] = []

  /**
   * @param builtins - the sources this package ships, asked last, in order.
   */
  constructor(private readonly builtins: readonly AnchorSource[]) {}

  /**
   * Add a contributor.
   * @param source - the contributor.
   * @returns its removal; calling it twice is harmless.
   */
  register(source: AnchorSource): () => void {
    this.sources.push(source)
    return () => {
      const at = this.sources.indexOf(source)
      if (at >= 0) this.sources.splice(at, 1)
    }
  }

  /**
   * Ask every contributor, newest first, and take the first real answer.
   *
   * A throwing source is skipped rather than allowed to take the summon down
   * with it: an anchor is an enrichment, and the input must open either way.
   * @returns the resolved anchor, {@link NO_ANCHOR} when nobody answered.
   */
  resolve(): Anchor {
    for (let index = this.sources.length - 1; index >= 0; index -= 1) {
      const found = call(this.sources[index])
      if (found !== undefined) return found
    }
    for (const source of this.builtins) {
      const found = call(source)
      if (found !== undefined) return found
    }
    return NO_ANCHOR
  }
}

/**
 * Run one source, swallowing its failure.
 * @param source - the contributor, or undefined from a raced splice.
 * @returns its anchor, or undefined when it had none or threw.
 */
function call(source: AnchorSource | undefined): Anchor | undefined {
  if (source === undefined) return undefined
  try {
    return source()
  } catch {
    return undefined
  }
}
