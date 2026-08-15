/**
 * What a side conversation shows, and — more to the point — what it does not.
 *
 * The harness's own conversation view is a working surface: reasoning, tool
 * calls, results, plans, retries, every step laid out because that column is
 * where you supervise the work. This one is not that. It is a question and an
 * answer, and the whole apparatus in between collapses into three words while
 * it runs.
 *
 * So this module is a PROJECTION, not a renderer: `ConversationSnapshot` in,
 * a short list of asks and answers out. Keeping it pure is what lets the one
 * rule that matters — which blocks are visible — be checked without a browser:
 *
 *   - `text` blocks are the answer;
 *   - `reasoning` blocks are never shown, not collapsed, not behind a
 *     disclosure. They are dropped;
 *   - `tool-call` blocks are not shown either, and an assistant step that
 *     produced ONLY tool calls contributes no turn at all — otherwise the
 *     transcript would fill with blank answers;
 *   - while the model is working and no answer text has arrived yet, that is
 *     one line: Deep diving.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/transcript
 */

import type {
  AssistantBlock, ConversationNode, ConversationSnapshot, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The harness's own content classifier, passed in rather than imported.
 *
 * Inverted on purpose. Classifying core content blocks is the runtime's job
 * and its `toAssistantBlocks` is the right implementation — but importing it
 * as a VALUE would make this module unloadable outside a source checkout of
 * the harness, and this module holds the one rule in the package most worth
 * checking. So production passes the real classifier and a spec passes a
 * two-line one, and the rule itself stays runnable anywhere.
 */
export type ClassifyContent = (content: UserMessageNode['content']) => readonly AssistantBlock[]

/** One visible exchange line. */
export type Turn =
  /** What the person asked, verbatim. */
  | { kind: 'ask'; key: string; text: string }
  /** What came back, once it had words. */
  | { kind: 'answer'; key: string; text: string; interrupted: boolean }

/** Everything the panel renders from. */
export interface TranscriptView {
  /** The exchange so far, in order. */
  turns: readonly Turn[]
  /**
   * True while the session is working and has produced no answer text yet —
   * the Deep diving line. Reasoning and tool calls both live in here.
   */
  diving: boolean
  /** Answer text arriving right now, when some has; rendered as it streams. */
  streaming: string | undefined
  /**
   * True for a conversation that has not started — as opposed to one whose
   * history simply has not arrived yet. Only the first kind is told what this
   * panel is for; the second is told nothing, because it already knows.
   */
  empty: boolean
}

/** The view of a session that is not there (not yet connected, or pruned). */
export const EMPTY_TRANSCRIPT: TranscriptView = {
  turns: [], diving: false, streaming: undefined, empty: true,
}

/**
 * The visible text of a block list.
 *
 * The one place the display rule is enforced. Everything that is not a `text`
 * block — reasoning, tool calls, images, whatever a future block kind turns
 * out to be — is absent from the result rather than replaced by a placeholder.
 * @param blocks - assistant blocks in source order.
 * @returns the concatenated visible text, trimmed.
 */
export function visibleText(blocks: readonly AssistantBlock[]): string {
  let text = ''
  for (const block of blocks) if (block.kind === 'text') text += block.text
  return text.trim()
}

/**
 * Project one node into a turn, or into nothing.
 * @param node - a conversation node.
 * @param classify - the content classifier (see {@link ClassifyContent}).
 * @returns the turn, or undefined for a node this surface does not show.
 */
function turnOf(node: ConversationNode, classify: ClassifyContent): Turn | undefined {
  if (node.kind === 'user') {
    const text = visibleText(classify(node.content))
    return text === '' ? undefined : { kind: 'ask', key: `u${String(node.seq)}`, text }
  }
  if (node.kind === 'assistant') {
    const text = visibleText(node.blocks)
    // A step that only called tools said nothing to the person. Rendering it
    // as an empty answer bubble would be worse than rendering nothing.
    if (text === '') return undefined
    return { kind: 'answer', key: `a${String(node.seq)}`, text, interrupted: node.interrupted === true }
  }
  // Steering, context, retries, tool results, commands, compaction summaries,
  // turn errors: all real, all the working column's business, none of it this
  // surface's. A side question does not come with a control room.
  return undefined
}

/**
 * Project a session snapshot into what the panel shows.
 * @param snapshot - the live conversation snapshot, or undefined before one exists.
 * @param classify - the content classifier (see {@link ClassifyContent}).
 * @returns the view (see {@link TranscriptView}).
 */
export function projectTranscript(
  snapshot: ConversationSnapshot | undefined,
  classify: ClassifyContent,
): TranscriptView {
  if (snapshot === undefined) return EMPTY_TRANSCRIPT

  const turns: Turn[] = []
  for (const node of snapshot.nodes) {
    const turn = turnOf(node, classify)
    if (turn !== undefined) turns.push(turn)
  }

  const partial = snapshot.partial === null ? '' : visibleText(snapshot.partial.blocks)
  const streaming = partial === '' ? undefined : partial
  // Working, with nothing to show for it yet. This is deliberately one state
  // rather than a tool-by-tool readout: which tool is running is exactly the
  // detail this surface promises not to carry.
  const diving = snapshot.running && streaming === undefined

  return {
    turns,
    diving,
    streaming,
    // Nothing to show is not the same fact as nothing to say. `blank` is the
    // host summary's own empty-log bit, and it is seeded the moment the
    // session face is minted — before any history is pulled — so it is the one
    // thing here that can tell a conversation that has not started from one
    // whose window is still on its way. Without it the panel introduces itself
    // over messages that are merely still loading.
    empty: turns.length === 0 && !diving && streaming === undefined && snapshot.blank,
  }
}
