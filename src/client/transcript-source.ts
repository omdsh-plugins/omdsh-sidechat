/**
 * One stable observable that always reads whichever side conversation is
 * current.
 *
 * The panel must not hold a session face. Faces come and go — New Chat
 * replaces one, a pruned session removes one, and a freshly connected one is
 * not in `sessions.binding` the instant its id is known. So the render side
 * gets a single source with a fixed identity, delivered through the `hooks`
 * inject compartment as `useTranscript`, and every one of those transitions
 * happens behind it.
 *
 * Three things can change what this reads, and all three are subscribed:
 *
 *   - the sidecar's identity (New Chat, restore);
 *   - the session list (the binding for a just-connected id appearing);
 *   - the session's own conversation (every token of every answer).
 *
 * And one thing has to be asked for: the history window. See
 * {@link openWindow} — a side conversation is never on stage, and the harness
 * pulls history for the session that is.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/transcript-source
 */

import type {
  ConversationSnapshot, ISessions, ObservableSnapshot, Session, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Pull a side conversation's history window.
 *
 * The harness opens a session's window when that session is STAGED — "the
 * window opens ⟺ the session is on stage" — and this one deliberately never
 * is: staging it would swap the conversation you are supervising for the one
 * you are asking beside it. Live frames still reach an unstaged session, which
 * is why a conversation held within one page load looked right; but nothing
 * ever fetched what was said BEFORE the panel bound to it, so a remembered
 * conversation came back from a reload empty and the panel greeted it with its
 * first-run copy.
 *
 * `open()` lives on the concrete Session rather than on the outward face, so
 * it is reached through the runtime's own exported class type: a typed reach
 * rather than an `any`, which makes a rename in the harness break this build
 * instead of this panel. Guarded at runtime as well, because the harness a
 * deployment ships need not be the one this was compiled against — a face
 * without the verb leaves the panel exactly as it was before this call
 * existed, live and empty until the next answer.
 *
 * Idempotent by the harness's own contract: an in-flight or completed open
 * returns the existing promise, so binding repeatedly costs one round trip per
 * conversation. It resolves after the window is installed, and it never
 * rejects — a failed pull lands in the snapshot's own `openState`/`openError`.
 * @param face - the bound session face.
 */
function openWindow(face: SessionFace): void {
  const open = (face as Session).open
  if (typeof open !== 'function') return
  void open.call(face)
}

/** The identity half this source follows. */
export interface SidecarIdentity {
  /** @returns the current side conversation, or undefined. */
  current: () => string | undefined
  /**
   * @param listener - called when the identity changes.
   * @returns unsubscribe.
   */
  subscribe: (listener: () => void) => () => void
}

/** The live conversation of whichever side session is current. */
export class TranscriptSource implements ObservableSnapshot<ConversationSnapshot | undefined> {
  private readonly listeners = new Set<() => void>()
  private boundId: string | undefined
  private offSession: (() => void) | undefined
  private teardown: (() => void) | undefined

  /**
   * @param sessions - the sessions service, for binding resolution.
   * @param sidecar - the identity to follow.
   */
  constructor(private readonly sessions: ISessions, private readonly sidecar: SidecarIdentity) {}

  /**
   * The current conversation.
   * @returns the snapshot, or undefined when no side conversation resolves.
   */
  getSnapshot(): ConversationSnapshot | undefined {
    const id = this.sidecar.current()
    if (id === undefined) return undefined
    return this.sessions.binding(id as never)?.session.getSnapshot()
  }

  /**
   * Subscribe to everything that can change the answer above.
   * @param listener - change callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.attach()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.release()
    }
  }

  /** Start following, on the first subscriber. */
  private attach(): void {
    const offIdentity = this.sidecar.subscribe(() => { this.rebind(); this.emit() })
    // A just-connected id has no binding yet; it arrives with the list frame.
    const offList = this.sessions.list.subscribe(() => {
      if (this.offSession === undefined) {
        this.boundId = undefined
        this.rebind()
        this.emit()
      }
    })
    this.rebind()
    this.teardown = () => {
      offIdentity()
      offList()
      this.offSession?.()
      this.offSession = undefined
      this.boundId = undefined
    }
  }

  /** Stop following, on the last unsubscribe. */
  private release(): void {
    this.teardown?.()
    this.teardown = undefined
  }

  /** Point the session subscription at the current identity. */
  private rebind(): void {
    const id = this.sidecar.current()
    if (id === this.boundId && this.offSession !== undefined) return
    this.offSession?.()
    this.offSession = undefined
    this.boundId = id
    const face = id === undefined ? undefined : this.sessions.binding(id as never)?.session
    if (face === undefined) return
    // Subscribed before opened, so the window's own arrival is one of the
    // changes this source reports rather than one it slept through.
    this.offSession = face.subscribe(() => { this.emit() })
    openWindow(face)
  }

  /** Tell the render side something moved. */
  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
