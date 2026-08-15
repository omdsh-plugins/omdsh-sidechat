/**
 * Getting one question into the SIDE conversation.
 *
 * Not the one you are looking at — that is the point of the whole plugin now.
 * The question, the answer, and every token spent reaching it belong to a
 * session of their own, so the working conversation's context is untouched by
 * anything asked here and its running turn is never interrupted by a passing
 * thought.
 *
 * What travels between the two is exactly one thing: the anchor, as text. A
 * path and a quotation, resolved for whichever directory the side conversation
 * happens to live in — see `resolveAnchorPath`. Nothing else crosses.
 *
 * Delivery mode still exists because the side conversation can be busy with a
 * previous question:
 *
 *   - **queue** (`agent.followup`, `next-turn`) waits for it to finish;
 *   - **steer** (`agent.steer`, `next-step`) cuts into it.
 *
 * Both wake an idle agent, so neither can fail for being sent at the wrong
 * moment.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/deliver
 */

import type { ISessions, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { Anchor } from './anchor.ts'
import { composePrompt } from './compose.ts'

/** The session id type as the runtime's list state brands it. */
export type SessionIdOf = NonNullable<SessionListState['current']>

/** How a question joins the side conversation. */
export type SendMode = 'queue' | 'steer'

/** Where a question is going, and where its anchor came from. */
export interface Target {
  /** The side conversation. */
  readonly sessionId: SessionIdOf
  /** True while it is working — the only state in which mode matters. */
  readonly running: boolean
  /** Its working directory: what the anchored path is made relative to. */
  readonly cwd?: string
  /** Working directory of the conversation the anchor came from. */
  readonly sourceCwd?: string
}

/** What became of a delivery. */
export type DeliverResult =
  | { readonly ok: true; readonly as: SendMode | 'command' }
  | { readonly ok: false; readonly code: string; readonly message: string }

/**
 * A session's working directory, as the list records it.
 * @param sessions - the live session list snapshot.
 * @param sessionId - the session to look up, or undefined.
 * @returns its cwd, or undefined when unrecorded.
 */
export function cwdOf(sessions: SessionListState, sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) return undefined
  const cwd = sessions.byId[sessionId as SessionIdOf]?.cwd
  return cwd === undefined || cwd === '' ? undefined : cwd
}

/**
 * Assemble the delivery target for one side conversation.
 * @param sessions - the live session list snapshot.
 * @param sessionId - the side conversation.
 * @param sourceSessionId - the conversation the anchor came from.
 * @returns the target.
 */
export function targetOf(
  sessions: SessionListState,
  sessionId: SessionIdOf,
  sourceSessionId: string | undefined,
): Target {
  const cwd = cwdOf(sessions, sessionId)
  const sourceCwd = cwdOf(sessions, sourceSessionId)
  return {
    sessionId,
    running: sessions.byId[sessionId]?.running === true,
    ...(cwd === undefined ? {} : { cwd }),
    ...(sourceCwd === undefined ? {} : { sourceCwd }),
  }
}

/**
 * Whether a draft should go to the command dispatcher instead of the model.
 *
 * A quotation disqualifies it: the command path takes a line and nothing else,
 * so a `/`-prefixed draft with an anchor attached would silently lose the
 * anchor, and silently losing the thing the person pointed at is the one
 * outcome this surface must never produce.
 * @param question - the trimmed draft.
 * @param anchor - the resolved anchor.
 * @returns true when the draft is a bare command line.
 */
export function isCommandLine(question: string, anchor: Anchor): boolean {
  return question.startsWith('/')
    && !question.includes('\n')
    && anchor.excerpt === undefined
    && anchor.path === undefined
}

/**
 * Send one question into the side conversation.
 * @param sessions - the sessions service.
 * @param target - the side conversation, from {@link targetOf}.
 * @param anchor - where the question was asked from.
 * @param question - what was typed; trimmed by the caller.
 * @param mode - queue or steer.
 * @returns what happened (see {@link DeliverResult}).
 */
export async function deliver(
  sessions: ISessions,
  target: Target,
  anchor: Anchor,
  question: string,
  mode: SendMode,
): Promise<DeliverResult> {
  if (question === '') return { ok: false, code: 'empty', message: 'nothing to send' }
  const session = sessions.binding(target.sessionId)?.session
  if (session === undefined) {
    return { ok: false, code: 'session-not-found', message: 'the side conversation is gone' }
  }

  const scope = {
    ...(target.sourceCwd === undefined ? {} : { source: target.sourceCwd }),
    ...(target.cwd === undefined ? {} : { target: target.cwd }),
  }

  try {
    if (isCommandLine(question, anchor)) {
      const result = await session.command(question)
      if (result.ok && result.value.matched) return { ok: true, as: 'command' }
      // An unmatched line is not a failure — it was never a command. It goes
      // to the model as the text it always was.
      if (!result.ok) return failure(result.error)
    }
    const result = await session.prompt(composePrompt(anchor, question, scope), mode)
    return result.ok ? { ok: true, as: mode } : failure(result.error)
  } catch (error) {
    // Only assembly faults reach here (an unmounted method, a dead carrier);
    // business failures come back through the result branch above.
    return { ok: false, code: 'internal', message: messageOf(error) }
  }
}

/**
 * Fold a carrier failure into this surface's result.
 *
 * Structural on purpose: `prompt` answers with an `RpcResult` and `command`
 * with a `RemoteResult`, two envelopes from two packages that agree on exactly
 * the two fields read here — and agreeing on those two is the whole contract
 * this file needs.
 * @param error - the failure branch of either envelope.
 * @returns the failed result.
 */
function failure(error: { readonly code: string; readonly message: string }): DeliverResult {
  return { ok: false, code: error.code, message: error.message }
}

/**
 * A thrown value's message.
 * @param error - the thrown value.
 * @returns its message, or its stringification.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
