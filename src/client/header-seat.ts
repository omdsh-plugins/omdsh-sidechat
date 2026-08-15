/**
 * Which conversations currently have the summon icon in their session header.
 *
 * The header's utility row is the icon's home, but that row is away in two
 * states a person spends real time in: the harness clears the whole header
 * while a conversation is still blank, and Code mode shadows the entire column
 * the header lives in. The understudy on the frame's floating layer exists for
 * both, and this is what keeps the two from ever showing at once.
 *
 * It reports MOUNT, not the rule behind it. When ui-conversation hides its
 * chrome is ui-conversation's business, and which plugin may take the
 * `conversation` seat is that plugin's; re-deriving either here would be a copy
 * of a private rule that can drift into two icons or none. So the header entry
 * announces itself while it is on screen, and the understudy renders only while
 * no announcement stands for its conversation — true whatever the reason the
 * header is away.
 *
 * The announcement doubles as the understudy's re-measure signal: the column
 * keeps its exact geometry when Code mode takes it, so nothing about its box
 * says the seat changed, but this store changes at exactly that moment.
 *
 * Keyed by conversation, and a count per key rather than a flag: entries are
 * per-session, one can mount before the last unmounts, and React re-runs an
 * effect it has already cleaned up.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/header-seat
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The conversations whose summon icon the session header is showing. */
export class HeaderSeats {
  /** The snapshot the understudy reads (published through the `hooks` compartment). */
  readonly store: SnapshotStore<readonly string[]> = createSnapshotStore<readonly string[]>([])

  /** Live claims per conversation; the snapshot is its key set. */
  private readonly claims = new Map<string, number>()

  /**
   * Announce that the header is showing this conversation's summon icon.
   * @param sessionId - the conversation whose header entry mounted.
   * @returns the release, safe to call more than once.
   */
  claim(sessionId: string): () => void {
    this.claims.set(sessionId, (this.claims.get(sessionId) ?? 0) + 1)
    this.publish()
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (this.claims.get(sessionId) ?? 1) - 1
      if (left > 0) this.claims.set(sessionId, left)
      else this.claims.delete(sessionId)
      this.publish()
    }
  }

  /** Publish the key set as a fresh array, so a snapshot never mutates underfoot. */
  private publish(): void {
    this.store.set([...this.claims.keys()])
  }
}

/**
 * Whether the header is currently showing the icon for this conversation.
 *
 * A conversation of `undefined` is never seated: the workspace picker has no
 * session header at all, so nothing can be holding a seat for it.
 * @param seats - the claimed conversations.
 * @param sessionId - the conversation in question.
 * @returns true while the header has it.
 */
export function isSeated(seats: readonly string[], sessionId: string | undefined): boolean {
  return sessionId !== undefined && seats.includes(sessionId)
}
