/**
 * Side chat, browser half. Three entries into slots the harness already
 * declares, one service published beside them, and one key listener.
 *
 * - `shell.overlay` (ui-layout) — the side conversation itself, on the
 *   frame-wide floating layer. A LIST slot, so standing here costs nobody
 *   their seat: `omdsh-sidepanel`'s panels are already on this layer and the two
 *   simply order among themselves.
 * - `conversation.session.header.utilities` (ui-conversation) — the icon that
 *   summons it, likewise a list seat beside whatever else is in that row.
 * - `shell.overlay` again — that icon's understudy, holding the utility row's
 *   corner in the two states where the row is not on screen: a blank
 *   conversation, and Code mode holding the whole conversation column. The
 *   panel works identically in all three modes, so its way in must exist in
 *   all three too — see [SideChatToggle](./SideChatToggle.tsx).
 * - `ctx.sidechat` — the anchor-source roster and the summon binding, so a
 *   panel that knows more about its own rows than the DOM can express, or a
 *   menu that wants to own the chord, can say so without either package
 *   importing the other.
 * - the window `keydown` listener — because the harness publishes no
 *   keybinding registry, and the discipline that makes that acceptable lives
 *   in [hotkey](./hotkey.ts). The chord it answers to is a setting, not a
 *   constant: `setSummonChord` rebinds it, and `setSummonChord(null)` stands
 *   the listener down entirely for a surface that has claimed the key
 *   natively.
 *
 * Nothing here is a harness change: the slot is a published seat, the
 * registration goes through `slots.inject()` (which waits for the declaration,
 * withdraws with it, and re-registers if it returns), and removing this
 * plugin's row removes the surface, the service and the listener together.
 *
 * The one rule read from the mode system — on a RESTRICTED fiber, so a
 * composition without `omdsh-base` behaves exactly as this plugin always did —
 * is the embed preference: in Chat and Work a new side conversation is created
 * as a fork of the conversation being supervised, so it carries that
 * conversation's context ([embed](./embed.ts), [sidecar](./sidecar.ts)). In
 * Code mode, whose column is a terminal with no conversation to embed, it
 * never is, and the panel's embed button stands greyed. Chat mode has no
 * workspace, so a question asked there simply carries no anchor — the panel is
 * still the shortest path from "I have a thought" to "it is answered", and
 * that is true with or without a directory. This is the one place this
 * package's rule differs from `omdsh-sidepanel`'s, and the reason is that a file
 * panel with nothing to show has nothing to be, while a conversation with no
 * anchor is still a conversation.
 * @module @omdsh-plugins/omdsh-sidechat/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Anchor } from './anchor.ts'
import { AnchorRegistry } from './anchor.ts'
import type { Chord } from './chord.ts'
import { DEFAULT_SUMMON_ACCELERATOR, parseAccelerator } from './chord.ts'
import type { ISideChat, SideChatInjected } from './contract.ts'
import { deliver, targetOf } from './deliver.ts'
import { selectionAnchor, selectionRect } from './dom-anchor.ts'
import { activeModeOf, CODE_MODE_ID, SESSION_MODES, type IModeSegments } from './embed.ts'
import { HeaderSeats } from './header-seat.ts'
import { installHotkey } from './hotkey.ts'
import { en, zh, type SideChatKey } from './locales.ts'
import { SideChatPanel, toAnchorRect } from './panel.ts'
import { BOX_SIZE, placeBox } from './place.ts'
import type { Placement } from './place.ts'
import { resolveServices } from './services.ts'
import {
  SHORTCUT_SERVICE, SUMMON_COMMAND, summonChordFrom, type IShortcutClient,
} from './shortcut.ts'
import { Sidecar } from './sidecar.ts'
import { SideChat } from './SideChat.tsx'
import { OverlayToggle, SideChatToggle } from './SideChatToggle.tsx'
import { TranscriptSource } from './transcript-source.ts'

export type { Anchor, AnchorSource } from './anchor.ts'
export type { Chord } from './chord.ts'
export { DEFAULT_SUMMON_ACCELERATOR } from './chord.ts'
export {
  SHORTCUT_SERVICE, SUMMON_COMMAND, summonChordFrom,
  type IShortcutClient, type ShortcutBinding, type ChordClaim,
} from './shortcut.ts'
export type { ISideChat } from './contract.ts'
export type { Box, HeaderAnchor } from './header-anchor.ts'
export {
  FURNITURE_GAP, HEADER_ROW_HEIGHT, STRIP_ATTRIBUTE,
  cornerHolderLeft, placeStrip,
} from './header-anchor.ts'
export { HeaderSeats, isSeated } from './header-seat.ts'
export type { SendMode } from './deliver.ts'
export type { SideChatKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete panel stays inside this plugin. */
    sidechat: ISideChat
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /**
     * The box's copy.
     *
     * Named for the package: a namespace has one owner, and registering a
     * second dictionary under a taken name throws at activation and takes the
     * whole plugin down with it.
     */
    'omdsh-sidechat': SideChatKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'omdsh-sidechat'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

/**
 * Mount the panel, its side conversation, its service, and the key that
 * summons it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const { sessions, workspaces } = resolveServices(ctx)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'omdsh-sidechat: dictionaries')

  // The built-in source is the floor of the roster: whatever else registers,
  // reading the live selection is always available and always last.
  const anchors = new AnchorRegistry([() => selectionAnchor(window.getSelection())])
  const panel = new SideChatPanel(DEFAULT_SUMMON_ACCELERATOR)
  // The mode holding the column, resolved on the restricted fiber below. Read
  // through a getter at connect time — the only moment the embed rule asks.
  let activeMode: string | undefined
  const sidecar = new Sidecar({
    sessions,
    workspaces,
    mode: () => activeMode,
    // A fork that fell back is still a working panel; the notice line says
    // the embed did not happen.
    onEmbedFallback: fallback => { panel.fail(fallback) },
  })
  const transcript = new TranscriptSource(sessions, sidecar)
  // One roster for both toggle seats, so the header icon and its understudy are
  // never up at the same time and never both away.
  const seats = new HeaderSeats()

  // The panel renders the identity and the embed state, the sidecar owns both:
  // one subscription keeps the three in step rather than every call site
  // writing each.
  ctx.effect(() => {
    const sync = (): void => {
      panel.attach(sidecar.current())
      panel.setEmbed(sidecar.parent() !== undefined, sidecar.parent())
    }
    const off = sidecar.subscribe(sync)
    sidecar.restore()
    sync()
    return off
  }, 'omdsh-sidechat: side conversation identity')

  // The embed rule's one mode read. A RESTRICTED fiber: a composition with no
  // mode system keeps the default — embeddable, the button enabled — and Code
  // mode is the only segment that declines. See ./embed.ts and rule 9 of the
  // conventions.
  ctx.inject([SESSION_MODES], (mctx) => {
    const modes = mctx.get(SESSION_MODES) as unknown as IModeSegments | undefined
    if (modes === undefined) return

    mctx.effect(() => {
      const follow = (): void => {
        const next = activeModeOf(modes.store.getSnapshot())
        activeMode = next
        panel.setEmbeddable(next !== CODE_MODE_ID)
      }
      follow()
      const off = modes.store.subscribe(follow)
      // Hand the answer back to "no mode system" — the embeddable default —
      // rather than freezing on the last mode the departing system reported.
      return () => {
        off()
        activeMode = undefined
        panel.setEmbeddable(true)
      }
    }, 'omdsh-sidechat: follow the active mode')
  })

  /** Resolve the anchor from wherever things stand right now. */
  const here = (): Anchor => anchors.resolve()

  /**
   * Where a panel that has never been placed should first appear: beside
   * whatever is selected. Consulted only on that first summon — after it the
   * panel keeps its own position, and dragging is the only thing that moves it.
   * @returns the offered spot.
   */
  const beside = (): Placement => placeBox(
    toAnchorRect(selectionRect(window.getSelection())),
    { width: window.innerWidth, height: window.innerHeight },
    BOX_SIZE,
  )

  const summon = (): void => {
    panel.open(here(), beside())
    // Connecting is not part of opening: the panel appears at once and the
    // conversation attaches when the round trip lands. A summon that waited on
    // the network would be a summon that feels broken.
    void sidecar.ensure()
  }

  // The binding is held here, not persisted. Configuration belongs to whoever
  // sets it — a menu plugin, a settings surface — and a copy of it in this
  // plugin's own storage would be a second source of truth that outlives the
  // thing that wrote it.
  let accelerator: string | undefined = DEFAULT_SUMMON_ACCELERATOR
  let chord: Chord | undefined = parseAccelerator(DEFAULT_SUMMON_ACCELERATOR)

  const service: ISideChat = {
    registerAnchorSource: source => anchors.register(source),
    open: summon,
    close: () => { panel.close() },
    summonChord: () => accelerator,
    setSummonChord: (next) => {
      if (next === null) {
        accelerator = undefined
        chord = undefined
        panel.bind(undefined)
        return
      }
      const parsed = parseAccelerator(next)
      if (parsed === undefined) {
        throw new Error(`omdsh-sidechat: "${next}" is not an accelerator this listener can bind`)
      }
      accelerator = next
      chord = parsed
      // The header icon teaches the chord in its tooltip, so a rebinding has
      // to reach the render side too. One write, both halves.
      panel.bind(next)
    },
  }

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('sidechat', service)
    // provide()'s disposer settles asynchronously; teardown is synchronous
    // fire-and-forget.
    return () => { void disposeService() }
  }, 'omdsh-sidechat: service')

  ctx.effect(() => installHotkey(window, {
    isOpen: () => panel.isOpen(),
    open: summon,
    close: () => { panel.close() },
  }, () => chord), 'omdsh-sidechat: summon key')

  // The handover, on a RESTRICTED fiber: a composition with no keybinding
  // layer never runs it and keeps the built-in ⌘L, which is what makes this
  // plugin usable on its own. Where there IS one, the key is given up so two
  // listeners never race for one chord, and the summon becomes a command the
  // document decides the chord for. See ./shortcut.ts for the protocol.
  ctx.inject([SHORTCUT_SERVICE], (sctx) => {
    const shortcut = sctx.get(SHORTCUT_SERVICE) as unknown as IShortcutClient | undefined
    if (shortcut === undefined) return

    sctx.effect(() => {
      service.setSummonChord(null)
      // Restoring the built-in on the way out matters: unloading the shortcut
      // plugin must give this one its key back, or removing a keybinding layer
      // would silently take the summon with it.
      return () => { service.setSummonChord(DEFAULT_SUMMON_ACCELERATOR) }
    }, 'omdsh-sidechat: yield the summon chord')

    sctx.effect(() => shortcut.register(SUMMON_COMMAND, summon), 'omdsh-sidechat: summon command')

    // The tooltip still teaches a key — the one the document gives this
    // command, re-read on every revision so a rebinding in the settings panel
    // lands without a reload.
    const showChord = (): void => { panel.bind(summonChordFrom(shortcut.bindings())) }
    sctx.effect(() => {
      const off = shortcut.onBindings(showChord)
      // The document usually arrives after this fiber does, so the first read
      // is often empty; the subscription is what fills it in. Reading anyway
      // covers the case where it landed first.
      showChord()
      return off
    }, 'omdsh-sidechat: follow the summon chord')
  })

  const injected = (): SideChatInjected => ({
    hooks: { sideChat: panel.store, transcript, headerSeats: seats.store },
    claimHeaderSeat: sessionId => seats.claim(sessionId),
    submit: async (question, mode) => {
      // Connected on demand: the first question is usually what creates the
      // side conversation, and making the panel wait for one before it opens
      // would put a round trip in front of every summon.
      const sessionId = await sidecar.ensure()
      if (sessionId === undefined) {
        panel.fail({ code: 'no-workspace', message: 'no workspace can host a side conversation' })
        return
      }
      const list = sessions.list.getSnapshot()
      const target = targetOf(list, sessionId, list.current)
      // The anchor is read at SUBMIT time, not at summon time: the panel
      // follows a selection that moves while it is open, and what was on
      // screen when Enter was pressed is what the question is about.
      const result = await deliver(sessions, target, panel.store.getSnapshot().anchor, question.trim(), mode)
      if (!result.ok) panel.fail({ code: result.code, message: result.message })
    },
    newChat: () => { void sidecar.fresh() },
    toggleEmbed: () => {
      // The button is disabled in Code mode; this guard is the same refusal
      // for a call that did not come through the button.
      if (activeMode === CODE_MODE_ID) return
      void sidecar.toggleEmbedded()
    },
    showInChat: () => {
      // It is an ordinary conversation in an ordinary workspace, so "show it"
      // is just navigation — no export, no copy, no second representation of
      // the same messages.
      const sessionId = panel.store.getSnapshot().sessionId
      if (sessionId === undefined) return
      sessions.open(sessionId as never)
      panel.close()
    },
    retarget: () => { panel.retarget(here()) },
    moveTo: (position) => { panel.moveTo(position) },
    open: summon,
    close: () => { panel.close() },
    clearNotice: () => { panel.clearNotice() },
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'omdsh-sidechat',
    // Above standing furniture (omdsh-sidepanel's panels sit at -10): this is
    // summoned over the app rather than part of it.
    order: 100,
    locale: NS,
    inject: injected,
  }, SideChat))

  // The mouse's way in. A LIST seat, so this is additive: omdsh-sidepanel's two
  // switches keep theirs and the row simply grows by one.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'omdsh-sidechat-toggle',
    // After the shipped utilities (which start at +10 and stop before 100) and
    // INBOARD of omdsh-sidepanel's pair, which takes 110 for the row's outer
    // corner. Deliberately not tied with that 110: the sort is stable, so a tie
    // would be decided by plugin load order and this icon would land in one of
    // two places per reload — and the two understudies below, which pack from
    // that same corner, would disagree with the row they stand in for.
    order: 105,
    locale: NS,
    inject: injected,
  }, SideChatToggle))

  // The same way in, wherever the utility row itself is away: a blank
  // conversation, whose header the harness clears entirely, and Code mode,
  // which shadows the whole `conversation` seat with a terminal. Without this
  // the panel has no mouse entry point in either state — and in Code mode no
  // keyboard one either, since the chord is yielded to the terminal.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'omdsh-sidechat-toggle-understudy',
    // Above standing furniture and below the panel it summons (100): it holds
    // the header row's corner, which is furniture of the same standing as
    // omdsh-sidepanel's own understudy at -9.
    order: -8,
    locale: NS,
    inject: injected,
  }, OverlayToggle))
}
