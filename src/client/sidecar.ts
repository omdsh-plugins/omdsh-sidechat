/**
 * The side conversation's own session: where it lives, how it is found again,
 * what New Chat does — and, by default, whose context it carries.
 *
 * The panel still does NOT talk to the conversation you are looking at. It owns
 * a session of its own, and the only contact between the two is the harness's
 * own fork verb: while the embed preference is on, a new side conversation is
 * created as a FORK of the supervised one, so its context is a copy of that
 * conversation's history. Nothing asked here enters the working session, and
 * nothing there has to make room for it — the fork is a branch, not a door.
 *
 * The preference is the button's job (see {@link toggleEmbedded}): turning it
 * off starts a plain independent session, which is how "remove the embedded
 * context from this window" is done — a context that is a session's history
 * cannot be removed in place, so the window simply moves to a new, unseeded
 * session and the fork stays in the list like any other conversation.
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
 * forked from (the embedded context), and `embed` is the preference the next
 * conversation will be created under. A record written by an older version of
 * this plugin is a bare id string, which is read as "no parent, preference on".
 */
export interface SideChatMemory {
  sessionId?: string
  parent?: string
  embed: boolean
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
    // A record written before the embed feature is a bare session id.
    if (raw[0] !== '{') return { sessionId: raw, embed: true }
    const parsed = JSON.parse(raw) as Partial<SideChatMemory>
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return {
      ...(typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.parent === 'string' && parsed.parent !== '' ? { parent: parsed.parent } : {}),
      embed: parsed.embed !== false,
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
}

/**
 * The side conversation's identity: resolve it, start a new one, and decide
 * which of them carries the supervised conversation's context.
 *
 * Connection is lazy and at most once at a time. The panel can be summoned
 * before any session exists, and summoning must not block on a round trip —
 * so the id arrives when it arrives and the transcript is empty until then.
 */
export class Sidecar {
  private id: SessionIdOf | undefined
  private parentId: string | undefined
  private preferEmbedded = true
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
   * Subscribe to changes of identity or embed state (a connection landing,
   * New Chat, the toggle).
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
    if (remembered !== undefined) this.set(remembered, memory.parent)
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
   * `connectWorkspace` reuses the workspace's blank session when it has one,
   * so pressing New Chat twice without saying anything lands in the same empty
   * conversation rather than littering the Chat workspace — the same rule the
   * harness's own New Session follows. A fork has no such reuse: it is a new
   * branch by construction.
   * @returns the new conversation's id, or undefined when there is nowhere to
   * put it.
   */
  async fresh(): Promise<SessionIdOf | undefined> {
    this.set(undefined, undefined)
    return this.connect()
  }

  /**
   * Flip the embed preference and start over under it.
   *
   * The button's whole job. Turning it OFF is how the embedded context leaves
   * the window: a context that is the session's own history cannot be removed
   * in place, so the panel moves to a fresh plain session and the fork stays
   * in the list. Turning it back ON forks the conversation currently being
   * supervised into a new side conversation.
   * @returns the new conversation's id, or undefined when there is nowhere to
   * put it.
   */
  async toggleEmbedded(): Promise<SessionIdOf | undefined> {
    this.preferEmbedded = !this.preferEmbedded
    return this.fresh()
  }

  /**
   * Connect a session, coalescing concurrent callers.
   * @returns the connected id, or undefined.
   */
  private async connect(): Promise<SessionIdOf | undefined> {
    this.connecting ??= this.connectOnce().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  /**
   * One connection attempt: a fork of the supervised conversation when the
   * embed rule says so, otherwise a plain session in the home workspace.
   * @returns the connected id, or undefined when no workspace can host it.
   */
  private async connectOnce(): Promise<SessionIdOf | undefined> {
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
        this.set(child, current)
        return child
      } catch {
        // Fall through to the plain path. The panel still works; the notice
        // (when wired) says the embed did not happen.
        this.deps.onEmbedFallback?.({ code: 'embed-failed', message: 'forking the supervised conversation failed' })
      }
    }

    const workspaces = this.deps.workspaces.list.getSnapshot().items as readonly WorkspaceRow[]
    const home = homeWorkspace(workspaces, current)
    if (home === undefined) return undefined
    // The cast is the workspaces service's own branded id, narrowed back from
    // the structural row shape this module reads.
    const connected = await this.deps.workspaces.connectWorkspace(home as never)
    this.set(connected as SessionIdOf, undefined)
    return connected as SessionIdOf
  }

  /**
   * Set the identity (and the fork source) and tell everyone.
   * @param next - the new id, or undefined to forget.
   * @param parent - the conversation the new session embeds, when it embeds one.
   */
  private set(next: SessionIdOf | undefined, parent: string | undefined): void {
    if (this.id === next && this.parentId === parent) return
    this.id = next
    this.parentId = parent
    remember(next === undefined
      ? { embed: this.preferEmbedded }
      : { sessionId: next, ...(parent === undefined ? {} : { parent }), embed: this.preferEmbedded })
    for (const listener of [...this.listeners]) listener()
  }
}
