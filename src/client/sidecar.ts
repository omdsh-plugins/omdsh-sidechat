/**
 * The side conversation's own session: where it lives, how it is found again,
 * and what New Chat does.
 *
 * The panel does NOT talk to the conversation you are looking at. It owns a
 * session of its own, so nothing asked here enters the working session's
 * context and nothing there has to make room for it. Two independent
 * conversations about the same workspace, which is the whole point: you can
 * ask what a function does without spending the turn budget of the task that
 * is actually running.
 *
 * Its home is the host-managed `Chat` workspace — the same workspace
 * `omdsh-justchat` creates and `omdsh-sidepanel` derives its mode from, matched
 * here by the title the user reads rather than by an import. That is a product
 * fact (it is the group heading in the sidebar), which is why three packages
 * can agree on it without depending on each other. A deployment without the
 * chat plugin has no such workspace; the fallback below keeps the panel
 * working there rather than making this plugin quietly require that one.
 * @module @omdsh-plugins/omdsh-sidechat/src/client/sidecar
 */

import type { ISessions, IWorkspaces, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

/** Display title of the host-managed Chat workspace, owned by `omdsh-justchat`. */
export const CHAT_WORKSPACE_TITLE = 'Chat'

/** localStorage key the side conversation is remembered under. */
export const STORAGE_KEY = 'omdsh-sidechat.session'

/** The session id type as the runtime's list state brands it. */
export type SessionIdOf = NonNullable<SessionListState['current']>

/** The workspace-list facts this module needs. */
interface WorkspaceRow {
  workspaceId: string
  title: string
  sessionIds: readonly string[]
}

/**
 * Which workspace a new side conversation belongs in.
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
 * Read the remembered id. A disabled or unreadable store is a first visit.
 * @returns the stored id, or null.
 */
export function loadRemembered(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

/**
 * Remember, or forget, the side conversation.
 * @param sessionId - the id to keep, or undefined to drop it.
 */
export function remember(sessionId: string | undefined): void {
  try {
    if (sessionId === undefined) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, sessionId)
  } catch {
    // Storage disabled or private mode: the panel simply starts a fresh side
    // conversation next reload, which is a working panel.
  }
}

/** The two services the sidecar reaches. */
export interface SidecarDeps {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
}

/**
 * The side conversation's identity: resolve it, and start a new one.
 *
 * Connection is lazy and at most once at a time. The panel can be summoned
 * before any session exists, and summoning must not block on a round trip —
 * so the id arrives when it arrives and the transcript is empty until then.
 */
export class Sidecar {
  private id: SessionIdOf | undefined
  private connecting: Promise<SessionIdOf | undefined> | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * @param deps - the sessions and workspaces services.
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
   * Subscribe to changes of identity (a connection landing, New Chat).
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
    const remembered = resolveRemembered(loadRemembered(), this.deps.sessions.list.getSnapshot())
    if (remembered !== undefined) this.set(remembered)
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
   * Start a new side conversation.
   *
   * `connectWorkspace` reuses the workspace's blank session when it has one,
   * so pressing this twice without saying anything lands in the same empty
   * conversation rather than littering the Chat workspace — the same rule the
   * harness's own New Session follows.
   * @returns the new conversation's id, or undefined when there is nowhere to
   * put it.
   */
  async fresh(): Promise<SessionIdOf | undefined> {
    this.set(undefined)
    return this.connect()
  }

  /**
   * Connect a session in the home workspace, coalescing concurrent callers.
   * @returns the connected id, or undefined.
   */
  private async connect(): Promise<SessionIdOf | undefined> {
    this.connecting ??= this.connectOnce().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  /**
   * One connection attempt.
   * @returns the connected id, or undefined when no workspace can host it.
   */
  private async connectOnce(): Promise<SessionIdOf | undefined> {
    const workspaces = this.deps.workspaces.list.getSnapshot().items as readonly WorkspaceRow[]
    const home = homeWorkspace(workspaces, this.deps.sessions.list.getSnapshot().current)
    if (home === undefined) return undefined
    // The cast is the workspaces service's own branded id, narrowed back from
    // the structural row shape this module reads.
    const connected = await this.deps.workspaces.connectWorkspace(home as never)
    this.set(connected as SessionIdOf)
    return connected as SessionIdOf
  }

  /**
   * Set the identity and tell everyone.
   * @param next - the new id, or undefined to forget.
   */
  private set(next: SessionIdOf | undefined): void {
    if (this.id === next) return
    this.id = next
    remember(next)
    for (const listener of [...this.listeners]) listener()
  }
}
