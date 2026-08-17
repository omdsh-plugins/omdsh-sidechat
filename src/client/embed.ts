/**
 * Whether a new side conversation carries the current conversation's context,
 * and how the plugin learns the mode that decides it.
 *
 * "Embedding" here is the harness's own fork verb: the side conversation is
 * created as a fork of the conversation being supervised, so its context IS
 * that conversation's history. Nothing is copied by this plugin and nothing
 * enters the supervised session — `sessions.fork` is the one supported way the
 * browser can ask the host for exactly that, and it is the same verb the
 * harness's own column uses to branch a conversation.
 *
 * The decision is a pure function because the rule deserves the same treatment
 * as the transcript's display rule: checkable without a browser. The mode —
 * which only decides whether embedding is OFFERED — arrives on a RESTRICTED
 * fiber, and its mirror type lives here for the same reason `shortcut.ts`
 * mirrors its own: cordis binds services by name at runtime, and a
 * cross-plugin value import is a client-bundle purity error.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/embed
 */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Service name the mode registry is published under, by
 * `@omdsh-plugins/omdsh-base`.
 *
 * A literal rather than an import — see the module note above, and rule 9 of
 * the conventions: a composition without the mode system keeps this plugin's
 * default behaviour rather than failing its boot audit.
 */
export const SESSION_MODES = 'sessionModes'

/**
 * The mode whose column is not a conversation at all, so there is nothing to
 * embed: `omdsh-codemode`'s terminal. A literal for the same reason as
 * {@link SESSION_MODES}: the id is a wire word the two packages share, not a
 * symbol one owns.
 */
export const CODE_MODE_ID = 'code'

/** As much of the mode registry as the embed rule needs. */
export interface IModeSegments {
  /** The switch's segments; exactly one is `active` at a time. */
  readonly store: ObservableSnapshot<readonly { id: string; active: boolean }[]>
}

/**
 * The mode holding the column, or undefined for a composition with no mode
 * system — which is the embeddable default, because without a mode system
 * there is no Code mode either and the column is always a conversation.
 * @param segments - the switch's live segments.
 * @returns the active segment's id, or undefined.
 */
export function activeModeOf(segments: readonly { id: string; active: boolean }[]): string | undefined {
  return segments.find(segment => segment.active)?.id
}

/** Everything the embed rule reads, pushed in rather than subscribed to. */
export interface EmbedDecision {
  /** The mode holding the column; undefined means no mode system. */
  mode: string | undefined
  /**
   * The person's preference, OFF by default: a side conversation embeds only
   * after the panel's branch button has turned the preference on.
   */
  preferEmbedded: boolean
  /** The conversation being supervised, if there is one. */
  current: string | undefined
  /** True when the supervised conversation has no log to carry. */
  currentBlank: boolean
}

/**
 * Whether a new side conversation should be forked from the supervised one.
 *
 * Every refusal is a case, not a failure: Code mode offers nothing to embed, a
 * blank conversation has no context to carry, and no conversation at all means
 * the usual blank-session connect.
 * @param decision - the facts above.
 * @returns true when the connect should fork.
 */
export function shouldEmbed(decision: EmbedDecision): boolean {
  if (!decision.preferEmbedded) return false
  if (decision.mode === CODE_MODE_ID) return false
  if (decision.current === undefined) return false
  if (decision.currentBlank) return false
  return true
}
