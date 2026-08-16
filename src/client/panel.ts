/**
 * The panel's own state: whether it is up, over what, whose conversation it is
 * showing, whether that conversation embeds a supervised one, and what went
 * wrong last.
 *
 * Held in a plugin-owned observable rather than a slot-declared store because
 * the state has to exist BEFORE the entry renders — the key listener writes it
 * from outside React — and because two entries in two DIFFERENT SCOPES read it
 * (the panel on the root overlay, the icon in the session header). A store
 * handle mounts under one scope and one only; the `hooks` inject compartment
 * is the sanctioned channel for exactly this.
 *
 * The conversation itself is NOT in here. It lives in the session, and the
 * panel reads it straight off `SessionFace` — which is an
 * `ObservableSnapshot<ConversationSnapshot>` — so the transcript has exactly
 * one source of truth and this store never has to mirror a message.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/panel
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Anchor } from './anchor.ts'
import { NO_ANCHOR } from './anchor.ts'
import type { AnchorRect, Placement } from './place.ts'
import { firstPlacement, loadPosition, savePosition } from './place.ts'

/**
 * A delivery that did not happen.
 *
 * Only failures live here. A successful send needs no announcement — the
 * question appears in the transcript, which is a better acknowledgement than
 * any banner, and one the person can still read a minute later.
 */
export interface Notice {
  code: string
  message: string
}

/** Everything the panel and the header icon render from. */
export interface SideChatState {
  /** True while the panel is up. */
  open: boolean
  /** Where the question is being asked from; recomputed on every summon. */
  anchor: Anchor
  /**
   * Where the panel sits, in viewport coordinates.
   *
   * Set ONCE, from wherever it was first summoned, and moved only by dragging
   * it. A panel that re-placed itself on every summon would jump around the
   * screen while you worked; one that followed the selection would move while
   * you were reading it. Neither is a window.
   */
  position: Placement | undefined
  /** The side conversation being shown, once one is connected. */
  sessionId: string | undefined
  /** Whether that conversation embeds a supervised conversation's context. */
  embedOn: boolean
  /** The conversation it embeds, when it embeds one. */
  embedParent: string | undefined
  /**
   * Whether the conversation is saved into the sidebar under its workspace.
   *
   * A fresh side conversation is hidden from the sidebar until the person
   * presses Save; a saved one — and one whose hide the host refused — reads
   * true and the Save control shows its done state.
   */
  saved: boolean
  /** Whether the current mode offers embedding at all (the button's enabled state). */
  embeddable: boolean
  /** The last delivery failure, until the next attempt. */
  notice: Notice | undefined
  /**
   * The bound chord in accelerator syntax, `undefined` while unbound.
   *
   * Render state, which is why it lives here rather than only in the closure
   * the listener reads: the header icon teaches the chord in its tooltip, and
   * a rebinding has to reach that tooltip. The parsed form stays in the
   * closure — this is the half that is displayed, that is the half that is
   * matched, and one setter writes both.
   */
  accelerator: string | undefined
}

/**
 * The state a browser that has never summoned the panel is in.
 * @param accelerator - the chord bound at mount.
 * @returns the initial state.
 */
export function defaultSideChat(accelerator?: string): SideChatState {
  return {
    open: false,
    anchor: NO_ANCHOR,
    position: loadPosition(),
    sessionId: undefined,
    embedOn: false,
    embedParent: undefined,
    saved: false,
    embeddable: true,
    notice: undefined,
    accelerator,
  }
}

/**
 * Copy a live rect into the plain record placement reads.
 * @param rect - the measured rect, or undefined when there was nothing to measure.
 * @returns the record, or undefined.
 */
export function toAnchorRect(rect: DOMRect | undefined): AnchorRect | undefined {
  if (rect === undefined) return undefined
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/**
 * The panel's state and its complete write set.
 *
 * Module level exports the class only; a module-level instance would be a
 * de-facto singleton surviving plugin reloads.
 */
export class SideChatPanel {
  readonly store: SnapshotStore<SideChatState>

  /**
   * @param accelerator - the chord bound at mount, for the header tooltip.
   */
  constructor(accelerator?: string) {
    this.store = createSnapshotStore<SideChatState>(defaultSideChat(accelerator))
  }

  /**
   * Summon the panel over a resolved anchor.
   *
   * The transcript is deliberately NOT cleared: reopening the panel returns
   * you to the conversation you were having, which is what makes it a
   * conversation rather than a series of one-shot questions. Starting over is
   * New Chat's job, and it is a button precisely so that it is deliberate.
   * @param anchor - where the question is being asked from.
   * @param beside - where to put it if it has never been placed before.
   */
  open(anchor: Anchor, beside: Placement): void {
    this.store.update((state) => {
      state.open = true
      state.anchor = anchor
      // Only the FIRST appearance takes the offered spot — see firstPlacement.
      state.position = firstPlacement(state.position, beside)
      state.notice = undefined
    })
    const settled = this.store.getSnapshot().position
    if (settled !== undefined) savePosition(settled)
  }

  /**
   * Follow a selection that moved while the panel was up.
   *
   * The anchor changes; the position never does. A window that slid across the
   * screen while you dragged a new selection would be a window you had to
   * chase.
   * @param anchor - the newly resolved anchor.
   */
  retarget(anchor: Anchor): void {
    this.store.update((state) => {
      if (!state.open) return
      state.anchor = anchor
    })
  }

  /**
   * Put the panel somewhere, and remember it there.
   * @param position - the dragged-to position, already clamped by the caller.
   */
  moveTo(position: Placement): void {
    this.store.update((state) => { state.position = position })
    savePosition(position)
  }

  /** Dismiss the panel. The conversation behind it is untouched. */
  close(): void {
    this.store.update((state) => {
      state.open = false
      state.anchor = NO_ANCHOR
      state.notice = undefined
    })
  }

  /**
   * Point the panel at a side conversation.
   * @param sessionId - the conversation, or undefined while none is connected.
   */
  attach(sessionId: string | undefined): void {
    this.store.update((state) => { state.sessionId = sessionId })
  }

  /**
   * Record whether the current conversation embeds a supervised one.
   * @param on - true while it is a fork of a supervised conversation.
   * @param parent - the fork source, when there is one.
   */
  setEmbed(on: boolean, parent: string | undefined): void {
    this.store.update((state) => {
      state.embedOn = on
      state.embedParent = parent
    })
  }

  /**
   * Record whether the current conversation is saved into the sidebar.
   * @param saved - true once it has a row under its workspace.
   */
  setSaved(saved: boolean): void {
    this.store.update((state) => { state.saved = saved })
  }

  /**
   * Record whether the current mode offers embedding. Only Code mode declines;
   * no mode system at all is the embeddable default.
   * @param embeddable - the button's enabled state.
   */
  setEmbeddable(embeddable: boolean): void {
    this.store.update((state) => { state.embeddable = embeddable })
  }

  /**
   * Report a delivery that failed.
   * @param notice - the failure.
   */
  fail(notice: Notice): void {
    this.store.update((state) => { state.notice = notice })
  }

  /** Drop the failure line — the next attempt is starting. */
  clearNotice(): void {
    this.store.update((state) => { state.notice = undefined })
  }

  /**
   * Record a rebinding so the surfaces that display the chord follow it.
   * @param accelerator - the new accelerator, or undefined while unbound.
   */
  bind(accelerator: string | undefined): void {
    this.store.update((state) => { state.accelerator = accelerator })
  }

  /**
   * Whether the panel is up (the key listener's read; it holds no React state).
   * @returns true while open.
   */
  isOpen(): boolean {
    return this.store.getSnapshot().open
  }
}
