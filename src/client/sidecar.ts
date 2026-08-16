/**
 * The side conversation's own session: where it lives, how it is found again,
 * what New Chat does — whose context it carries when asked, and when it joins
 * the sidebar.
 *
 * The panel still does NOT talk to the conversation you are looking at. It owns
 * a session of its own, and the only contact between the two is the harness's
 * own fork verb: while the embed preference is on, a new side conversation is
 * created as a FORK of the supervised one, so its context is a copy of that
 * conversation's history. Nothing asked here enters the working session, and
 * nothing there has to make room for it — the fork is a branch, not a door.
 * The preference is OFF by default (see {@link toggleEmbedded}): embedding is
 * something the person asks for, not something a side conversation is.
 *
 * A side conversation stays OUT of the sidebar until the person saves it.
 * Whatever path created it — a fork, or a fresh blank session in the home
 * workspace — is hidden the moment it is connected, through the workspace
 * registry's own archive verb: the conversation and its workspace account stay
 * intact, only the grouping surfaces stop drawing it. Pressing Save is then a
 * fork of the hidden conversation: the child carries its history, inherits its
 * workspace, and is NOT hidden, so it appears in the sidebar under the right
 * workspace and the panel goes on talking into it. The harness offers no
 * "unhide" verb, so a saved conversation is a new branch by construction —
 * the hidden one stays hidden, and the saved one is where the talking happens.
 *
 * Its home for a plain session is the host-managed `Chat` workspace — the same
 * workspace `omdsh-justchat` creates and `omdsh-sidepanel` derives its mode
 * from, matched here by the title the user reads rather than by an import. That
 * is a product fact (it is the group heading in the sidebar), which is why
 * three packages can agree on it without depending on each other. A deployment
 * without the chat plugin has no such workspace; the fallback below keeps the
 * panel working there rather than making this plugin quietly require that one.
 * A forked session needs no home: it inherits the source's workspace, which is
 * where its context belongs.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/sidecar
 */

import type { ISessions, IWorkspaces, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { shouldEmbed, type EmbedDecision } from './embed.ts'

/** Display title of the host-managed Chat workspace, owned by `omdsh-justchat`. */
export const CHAT_WORKSPACE_TITLE = 'Chat'

/** localStorage key the side conversation is remembered under. */
export const STORAGE_KEY = 'omdsh-sidechat.session'

/** The session id type as the runtime's list state brands it. */
export type SessionIdOf = NonNullable<SessionListState['current']>

/**
 * What the side conversation is, remembered across reloads.
 *
 * The id is the conversation itself; `parent` names the conversation it was
 * forked from (the embedded context); `embed` is the preference the next
 * conversation will be created under; and `saved` records whether the
 * conversation is visible in the sidebar. A record written by an older version
 * of this plugin is a bare id string, which is read as "no parent, preference
 * off, saved" — the conversation an older version remembered was always
 * visible, and the new default is to embed only when asked.
 */
export interface SideChatMemory {
  sessionId?: string
  parent?: string
  embed: boolean
  saved: boolean
}

/** The workspace-list facts this module needs. */
interface WorkspaceRow {
  workspaceId: string
  title: string
  sessionIds: readonly string[]
}

/**
 * Which workspace a new plain side conversation belongs in.
 *
 * `Chat` when it exists. Otherwise the workspace accounting the conversation
 * you are looking at — a second session beside the first, which still keeps
 * the two contexts apart even though they share a directory. Failing both
 * (no workspaces at all), undefined: there is nowhere to put it, and inventing
 * a directory is not this plugin's business.
 * @param workspaces - the live workspace rows.
 * @param current - the current session id, for the fallback.
 * @returns the target workspace id, or undefined.
 */
export function homeWorkspace(
  workspaces: readonly WorkspaceRow[],
  current: string | undefined,
): string | undefined {
  const chat = workspaces.find(row => row.title === CHAT_WORKSPACE_TITLE)
  if (chat !== undefined) return chat.workspaceId
  if (current === undefined) return undefined
  return workspaces.find(row => row.sessionIds.includes(current))?.workspaceId
}

/**
 * The remembered side conversation, if it is still real.
 *
 * A stored id outlives the session it names — the conversation can be deleted
 * from the session list like any other — so it is verified against the live
 * list before being trusted. An id that no longer resolves is not an error, it
 * is a conversation that ended.
 * @param stored - the remembered id, or null.
 * @param sessions - the live session list snapshot.
 * @returns the id when it still resolves, undefined otherwise.
 */
export function resolveRemembered(
  stored: string | null,
  sessions: SessionListState,
): SessionIdOf | undefined {
  if (stored === null || stored === '') return undefined
  return stored in sessions.byId ? (stored as SessionIdOf) : undefined
}

/**
 * Read the remembered record. A disabled or unreadable store is a first visit;
 * an unparsable record is the same, on the same principle as an id that no
 * longer resolves: it is a conversation that ended, not an error to raise.
 * @returns the memory, or undefined when nothing survived the read.
 */
export function loadRemembered(): SideChatMemory | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
    if (raw === null || raw === '') return undefined
    // A record written before the embed feature is a bare session id. Such a
    // conversation was always visible in the sidebar, and the current default
    // is to embed only when asked.
    if (raw[0] !== '{') return { sessionId: raw, embed: false, saved: true }
    const parsed = JSON.parse(raw) as Partial<SideChatMemory>
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return {
      ...(typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.parent === 'string' && parsed.parent !== '' ? { parent: parsed.parent } : {}),
      // Embedding is opt-in now, so only an explicitly stored true turns it on.
      embed: parsed.embed === true,
      // Records written before the save feature carry no flag; their
      // conversations were never hidden, which reads as saved.
      saved: parsed.saved !== false,
    }
  } catch {
    return undefined
  }
}

/**
 * Remember, or forget, the side conversation and its embed state.
 * @param memory - the record to keep, or undefined to drop it.
 */
export function remember(memory: SideChatMemory | undefined): void {
  try {
    if (memory === undefined) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Storage disabled or private mode: the panel simply starts a fresh side
    // conversation next reload, which is a working panel.
  }
}

/**
 * A fork that could not be made: what the connect fell back from.
 *
 * Kept minimal on purpose — the message goes to the panel's notice line, and
 * the details (which transport failed, which host refused) are the host's
 * business, not this surface's.
 */
export interface EmbedFallback {
  code: 'embed-failed'
  message: string
}

/** A save that could not be made: the fork the sidebar row would come from. */
export interface SaveFailure {
  code: 'save-failed'
  message: string
}

/** The three services the sidecar reaches. */
export interface SidecarDeps {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  /**
   * The mode holding the column right now, or undefined with no mode system.
   * A getter rather than a subscription: connect is the only moment the answer
   * matters, and reading it there keeps the sidecar free of a second store.
   */
  readonly mode: () => string | undefined
  /**
   * Report a requested fork that fell back to a plain session. Optional: a
   * silent fallback is still a working panel, and the button's state tells the
   * truth either way.
   * @param fallback - what happened.
   */
  onEmbedFallback?: (fallback: EmbedFallback) => void
  /**
   * Report a save that could not be made. Optional: the conversation simply
   * stays hidden, and the Save button keeps offering.
   * @param failure - what happened.
   */
  onSaveFailed?: (failure: SaveFailure) => void
  /**
   * Create a fresh blank session in a workspace — the host's `session.create`,
   * reached through the concrete runtime. A deliberate reach rather than
   * `connectWorkspace`, whose blank reuse can hand back the conversation the
   * person is looking at, which must never be hidden.
   * @param opts - the target workspace.
   * @returns the new session id.
   */
  createSession: (opts: { workspaceId: string }) => Promise<string>
  /**
   * Hide a session from every grouping surface, keeping its log and its
   * workspace account.
   * @param sessionId - the session to hide.
   * @returns whether it is now hidden; false when the host refused.
   */
  archiveSession: (sessionId: string) => Promise<boolean>
}

/**
 * The side conversation's identity: resolve it, start a new one, decide which
 * of them carries the supervised conversation's context, and save it into the
 * sidebar when asked.
 *
 * Connection is lazy and at most once at a time. The panel can be summoned
 * before any session exists, and summoning must not block on a round trip —
 * so the id arrives when it arrives and the transcript is empty until then.
 */
export class Sidecar {
  private id: SessionIdOf | undefined
  private parentId: string | undefined
  private preferEmbedded = false
  private isSaved = false
  private connecting: Promise<SessionIdOf | undefined> | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * @param deps - the sessions, workspaces, mode and fallback report.
   */
  constructor(private readonly deps: SidecarDeps) {}

  /**
   * The current side conversation, if one is connected.
   * @returns its id, or undefined before the first connection lands.
   */
  current(): SessionIdOf | undefined {
    return this.id
  }

  /**
   * The conversation whose context this side conversation embeds.
   * @returns the fork source, or undefined for a plain session.
   */
  parent(): string | undefined {
    return this.parentId
  }

  /**
   * Whether the next side conversation will be created as a fork.
   * @returns the embed preference.
   */
  prefersEmbedded(): boolean {
    return this.preferEmbedded
  }

  /**
   * Whether the current conversation is visible in the sidebar — saved, or a
   * hide that the host refused.
   * @returns true while it has a row under its workspace.
   */
  saved(): boolean {
    return this.isSaved
  }

  /**
   * Subscribe to changes of identity, saved or embed state (a connection
   * landing, New Chat, the toggle, a save).
   * @param listener - change callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Adopt the remembered conversation, when it is still real.
   *
   * Called once at mount. Does no round trip: a remembered id either resolves
   * against the session list already in hand or it does not.
   */
  restore(): void {
    const memory = loadRemembered()
    if (memory === undefined) return
    this.preferEmbedded = memory.embed
    const remembered = resolveRemembered(memory.sessionId ?? null, this.deps.sessions.list.getSnapshot())
    if (remembered !== undefined) this.set(remembered, memory.parent, memory.saved)
  }

  /**
   * Ensure a side conversation exists, connecting one if needed.
   * @returns its id, or undefined when there is nowhere to put it.
   */
  async ensure(): Promise<SessionIdOf | undefined> {
    if (this.id !== undefined) return this.id
    return this.connect()
  }

  /**
   * Start a new side conversation under the current preference.
   *
   * Our own previous conversation is reused while it is still blank — pressing
   * New Chat twice without saying anything lands in the same empty
   * conversation rather than littering the workspace with hidden shells — the
   * same rule the harness's own New Session follows. A fork has no such reuse:
   * it is a new branch by construction.
   * @returns the new conversation's id, or undefined when there is nowhere to
   * put it.
   */
  async fresh(): Promise<SessionIdOf | undefined> {
    const previous = this.id
    this.set(undefined, undefined)
    return this.connect(previous)
  }

  /**
   * Flip the embed preference and start over under it.
   *
   * The button's whole job. Turning it ON forks the conversation currently
   * being supervised into a new side conversation carrying its context;
   * turning it OFF is how the embedded context leaves the window: a context
   * that is the session's own history cannot be removed in place, so the panel
   * moves to a fresh plain session and the fork stays in the list — hidden,
   * like every unsaved side conversation.
   * @returns the new conversation's id, or undefined when there is nowhere to
   * put it.
   */
  async toggleEmbedded(): Promise<SessionIdOf | undefined> {
    this.preferEmbedded = !this.preferEmbedded
    return this.fresh()
  }

  /**
   * Save the current conversation into the sidebar, under its workspace.
   *
   * The harness has no "unhide" verb, so saving cuts a fork of the hidden
   * conversation: the child inherits its history, working directory and
   * workspace, is never hidden, and becomes the conversation the panel talks
   * into. The hidden original stays hidden. Refused — silently, the button
   * being the reason it cannot happen — while the conversation is still blank
   * or mid-answer: a fork is a snapshot of the last COMPLETED turn, so saving
   * then would either drop the answer in flight or leave a blank session in
   * the workspace account for New Session to reuse.
   * @returns the saved conversation's id, or undefined when nothing was saved.
   */
  async save(): Promise<SessionIdOf | undefined> {
    const current = this.id
    if (current === undefined || this.isSaved) return current
    const summary = this.deps.sessions.list.getSnapshot().byId[current]
    if (summary?.blank !== false || summary.running) return undefined
    try {
      const child = await this.deps.sessions.fork({ sessionId: current })
      this.set(child, this.parentId, true)
      return child
    } catch {
      this.deps.onSaveFailed?.({ code: 'save-failed', message: 'saving the side conversation failed' })
      return undefined
    }
  }

  /**
   * Connect a session, coalescing concurrent callers.
   * @param previous - the conversation fresh() left behind, for blank reuse.
   * @returns the connected id, or undefined.
   */
  private connect(previous?: SessionIdOf): Promise<SessionIdOf | undefined> {
    this.connecting ??= this.connectOnce(previous).finally(() => { this.connecting = undefined })
    return this.connecting
  }

  /**
   * One connection attempt: a fork of the supervised conversation when the
   * embed rule says so, otherwise a fresh plain session in the home workspace.
   * Either way the conversation is hidden from the sidebar until saved.
   * @param previous - the conversation fresh() left behind, for blank reuse.
   * @returns the connected id, or undefined when no workspace can host it.
   */
  private async connectOnce(previous: SessionIdOf | undefined): Promise<SessionIdOf | undefined> {
    const list = this.deps.sessions.list.getSnapshot()
    const current = list.current
    const decision: EmbedDecision = {
      mode: this.deps.mode(),
      preferEmbedded: this.preferEmbedded,
      current,
      currentBlank: current === undefined ? true : list.byId[current as SessionIdOf]?.blank === true,
    }
    if (shouldEmbed(decision)) {
      try {
        // The host forks from a completed-turn prefix, so a supervised session
        // mid-turn is fine: the child carries everything up to the last
        // completed turn. The child is never blank and inherits the source's
        // workspace and cwd.
        const child = await this.deps.sessions.fork({ sessionId: current as SessionIdOf })
        return this.adopt(child, current)
      } catch {
        // Fall through to the plain path. The panel still works; the notice
        // (when wired) says the embed did not happen.
        this.deps.onEmbedFallback?.({ code: 'embed-failed', message: 'forking the supervised conversation failed' })
      }
    }

    // The plain path. Our own previous conversation is reused while it is
    // still blank, so New Chat pressed twice does not litter the workspace
    // with hidden shells.
    if (previous !== undefined && list.byId[previous]?.blank === true) {
      this.set(previous, undefined)
      return previous
    }

    const workspaces = this.deps.workspaces.list.getSnapshot().items as readonly WorkspaceRow[]
    const home = homeWorkspace(workspaces, current)
    if (home === undefined) return undefined
    const connected = await this.deps.createSession({ workspaceId: home })
    return this.adopt(connected as SessionIdOf, undefined)
  }

  /**
   * Take a freshly connected conversation and hide it from the sidebar.
   *
   * The hide is the workspace registry's own archive verb — the log and the
   * workspace account are untouched, only the grouping surfaces stop drawing
   * it. A hide the host refused leaves the conversation visible, which is
   * read as saved: it already has the sidebar row Save would create.
   * @param next - the connected conversation.
   * @param parent - the conversation it embeds, when it embeds one.
   * @returns the adopted id.
   */
  private async adopt(next: SessionIdOf, parent: string | undefined): Promise<SessionIdOf> {
    const hidden = await this.deps.archiveSession(next)
    this.set(next, parent, !hidden)
    return next
  }

  /**
   * Set the identity (and the fork source, and the saved state) and tell
   * everyone.
   * @param next - the new id, or undefined to forget.
   * @param parent - the conversation the new session embeds, when it embeds one.
   * @param saved - whether it is visible in the sidebar; omitted keeps the
   * state in hand (a blank reuse changes nothing about visibility).
   */
  private set(next: SessionIdOf | undefined, parent: string | undefined, saved?: boolean): void {
    if (this.id === next && this.parentId === parent && (saved === undefined || this.isSaved === saved)) return
    this.id = next
    this.parentId = parent
    if (saved !== undefined) this.isSaved = saved
    remember(next === undefined
      ? { embed: this.preferEmbedded, saved: false }
      : {
          sessionId: next,
          ...(parent === undefined ? {} : { parent }),
          embed: this.preferEmbedded,
          saved: this.isSaved,
        })
    for (const listener of [...this.listeners]) listener()
  }
}
