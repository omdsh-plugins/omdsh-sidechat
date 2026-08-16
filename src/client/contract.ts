/**
 * What this plugin's one surface is handed, and the one thing it offers back.
 *
 * The surface lives in `shell.overlay` — ui-layout's frame-wide floating
 * layer, a LIST slot, which is why standing on it costs nobody their seat:
 * `omdsh-sidepanel`'s panels are already there and the two simply order among
 * themselves. This package declares no slot of its own; it contributes an
 * entry and nothing more.
 *
 * `ISideChat` is the other direction. It exists so a panel that knows more
 * about its own rows than the DOM can express is able to say so without this
 * package importing it, and without it importing this package's runtime — the
 * client bundle's purity gate forbids that in both directions. A service and
 * two attributes are the entire cross-plugin surface.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/contract
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-layout's and ui-conversation's SlotMap merges (the two
// target slots) and the runtime's standard-props merge into this program. A
// value import would be a purity error.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AnchorSource } from './anchor.ts'
import type { Placement } from './place.ts'
import type { SendMode } from './deliver.ts'
import type { SideChatState } from './panel.ts'

/**
 * The service this plugin publishes as `ctx.sidechat`.
 *
 * Two jobs and no more: contribute anchors, and decide what summons the box.
 * Anything richer — reading the current anchor, writing the draft, choosing
 * the delivery mode — would make this a remote control for somebody else's
 * input box, and the question of who is asking would stop having an answer.
 *
 * `open()` plus `setSummonChord()` is deliberately the whole binding story. A
 * surface that wants its own way in calls `open()`; a surface that wants THE
 * key calls `setSummonChord(null)` and binds it itself. Between them there is
 * no case where two handlers race for the same keystroke.
 */
export interface ISideChat {
  /**
   * Contribute anchors for the surfaces you own.
   *
   * Asked before the built-in DOM reading and before every earlier
   * registration, so a later, more specific contributor wins. Return
   * `undefined` for a moment you know nothing about.
   * @param source - the contributor.
   * @returns its removal.
   */
  registerAnchorSource: (source: AnchorSource) => () => void
  /** Summon the input, resolving the anchor from wherever things stand now. */
  open: () => void
  /** Dismiss it, discarding the draft. */
  close: () => void
  /**
   * The chord currently bound, in Electron accelerator syntax; `undefined`
   * while unbound.
   * @returns the accelerator, exactly as it was set.
   */
  summonChord: () => string | undefined
  /**
   * Rebind the summon chord, or hand the key back.
   *
   * The vocabulary is Electron's accelerator syntax — the same one
   * `omdsh-shortcuts`'s `MenuItem.accelerator` is written in — so a chord can
   * move between this in-page listener and a native menu item without either
   * package learning the other's spelling.
   *
   * Passing `null` unbinds entirely: the listener then consumes nothing at
   * all, which is what a surface that has claimed the key natively needs it to
   * do. `open()` still works, so an unbound sidechat is reachable, just not by
   * this plugin's own keystroke.
   *
   * A malformed accelerator THROWS rather than being ignored. A binding that
   * silently does not exist is the worst of the three outcomes: the key simply
   * stops working and nothing says why.
   * @param accelerator - e.g. `CmdOrCtrl+Shift+K`, or null to unbind.
   * @throws when the accelerator names no chord this listener can bind.
   */
  setSummonChord: (accelerator: string | null) => void
}

/** The panel's state and its complete write set, as the entries receive them. */
export interface SideChatInjected {
  /** Framework-bound sources, delivered as `useSideChat`, `useTranscript` and `useHeaderSeats`. */
  hooks: {
    /** The live panel state. */
    sideChat: ObservableSnapshot<SideChatState>
    /**
     * The side conversation itself, straight off its `SessionFace`.
     *
     * One stable source that follows whichever session is current, so the
     * render side never holds a face and New Chat is not a remount.
     */
    transcript: ObservableSnapshot<ConversationSnapshot | undefined>
    /**
     * The conversations whose summon icon the session header is currently
     * showing — how the understudy knows to stand down.
     */
    headerSeats: ObservableSnapshot<readonly string[]>
  }
  /**
   * Announce that the header is showing this conversation's summon icon.
   * @param sessionId - the conversation whose header entry mounted.
   * @returns the release.
   */
  claimHeaderSeat: (sessionId: string) => () => void
  /**
   * Deliver one question into the current conversation and report the outcome
   * through the panel state.
   *
   * Resolution of the target — which session, its working directory, whether
   * it is running — happens HERE rather than in the component, so the render
   * side never holds a session face.
   * @param question - the draft, trimmed by the caller.
   * @param mode - queue or steer.
   * @returns completion; failures are reported, never thrown.
   */
  submit: (question: string, mode: SendMode) => Promise<void>
  /** Re-resolve the anchor against the current selection. The panel does not move. */
  retarget: () => void
  /**
   * Put the panel somewhere, and remember it there.
   * @param position - the dragged-to position, already clamped by the caller.
   */
  moveTo: (position: Placement) => void
  /** Summon the panel — the header icon's whole job. */
  open: () => void
  /**
   * Start a fresh side conversation. The previous one stays hidden where it
   * was; a saved one keeps its sidebar row and can be reopened like any other.
   */
  newChat: () => void
  /**
   * Flip the embed preference and start over under it.
   *
   * Turning it OFF starts a plain side conversation, which is how the embedded
   * context leaves this window — a context that is a session's history cannot
   * be removed in place. Turning it back ON forks the conversation currently
   * being supervised into a new side conversation. No-op in Code mode, where
   * the button is disabled: embedding is not offered there.
   */
  toggleEmbed: () => void
  /**
   * Open the side conversation in the main window, where it is an ordinary
   * conversation in the Chat workspace, and dismiss the panel.
   */
  showInChat: () => void
  /**
   * Save the side conversation into the sidebar, under its workspace.
   *
   * Until this runs the conversation is hidden from the sidebar. Saving cuts a
   * fork of it that is not hidden, and the panel goes on talking into that
   * fork; failures are reported through the panel state. No-op while the
   * conversation is still blank or mid-answer (the button is disabled then),
   * and once it is already saved.
   */
  save: () => void
  /** Dismiss the panel. */
  close: () => void
  /** Drop the failure line — the next attempt is starting. */
  clearNotice: () => void
}

/** Full props of the overlay entry: the floating seat, the state, and copy. */
export type SideChatProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<SideChatInjected>
  & PropsLocale<'omdsh-sidechat'>

/**
 * Full props of the header icon: the utility seat, the same state, and copy.
 *
 * One injected face serves both entries even though their slots sit in
 * DIFFERENT SCOPES — root for the overlay, session for the header. That is
 * exactly why the state is a plugin-owned observable delivered through the
 * reserved `hooks` compartment instead of a declared store: a store handle
 * mounts under one scope and one only.
 */
export type SideChatToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<SideChatInjected>
  & PropsLocale<'omdsh-sidechat'>

/**
 * Full props of the icon's understudy: the same floating seat the panel is on,
 * the same state, the same copy.
 *
 * A second entry into `shell.overlay` rather than a branch inside the panel's:
 * the two are independent surfaces with independent visibility, and a list slot
 * is exactly the seat that makes standing twice free.
 */
export type OverlayToggleProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<SideChatInjected>
  & PropsLocale<'omdsh-sidechat'>
