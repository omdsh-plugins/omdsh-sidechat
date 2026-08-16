// @vitest-environment jsdom
/**
 * The embed rule and the sidecar's half of it.
 *
 * The pure decision function is the whole policy — when a new side
 * conversation is a fork of the one being supervised — checked without a
 * browser, the same discipline `transcript.ts` applies to the display rule.
 * The Sidecar cases then check the things the decision cannot: that the fork
 * verb is what actually creates the conversation, that a failed fork falls
 * back to the plain connect rather than failing the summon, that every fresh
 * conversation is hidden from the sidebar, and that Save is the fork which
 * puts one there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { activeModeOf, shouldEmbed } from '../src/client/embed.ts'
import { loadRemembered, Sidecar, STORAGE_KEY, type SidecarDeps } from '../src/client/sidecar.ts'

/** One list row as the sidecar reads it. */
function row(blank = false): { blank: boolean } {
  return { blank }
}

/** The two services the sidecar reaches, over fixed answers. */
function deps(overrides: {
  current?: string
  byId?: Record<string, { blank: boolean; running?: boolean }> | (() => Record<string, { blank: boolean; running?: boolean }>)
  mode?: () => string | undefined
  fork?: (opts: { sessionId: string }) => Promise<string>
  createSession?: (opts: { workspaceId: string }) => Promise<string>
  archiveSession?: (sessionId: string) => Promise<boolean>
  items?: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[]
  onEmbedFallback?: SidecarDeps['onEmbedFallback']
  onSaveFailed?: SidecarDeps['onSaveFailed']
} = {}) {
  const fork = overrides.fork ?? vi.fn(async ({ sessionId }: { sessionId: string }) => `child-of-${sessionId}`)
  const createSession = overrides.createSession ?? vi.fn(async ({ workspaceId }: { workspaceId: string }) => `blank-${workspaceId}`)
  const archiveSession = overrides.archiveSession ?? vi.fn(async () => true)
  const byId = overrides.byId ?? {}
  const sessions = {
    list: {
      getSnapshot: () => ({
        current: overrides.current,
        byId: typeof byId === 'function' ? byId() : byId,
      }),
    },
    fork,
  } as unknown as ISessions
  const workspaces = {
    list: {
      getSnapshot: () => ({
        items: overrides.items ?? [{ workspaceId: 'chat-ws', title: 'Chat', sessionIds: [] }],
      }),
    },
  } as unknown as IWorkspaces
  return {
    fork,
    createSession,
    archiveSession,
    deps: {
      sessions,
      workspaces,
      mode: overrides.mode ?? (() => 'work'),
      createSession,
      archiveSession,
      ...(overrides.onEmbedFallback === undefined ? {} : { onEmbedFallback: overrides.onEmbedFallback }),
      ...(overrides.onSaveFailed === undefined ? {} : { onSaveFailed: overrides.onSaveFailed }),
    } as SidecarDeps,
  }
}

// An in-memory Storage rather than jsdom's. Node ships an experimental
// `localStorage` global that shadows jsdom's inside vitest and answers with a
// stub that has no `clear` — a real trap, and one a stub sidesteps entirely
// while testing exactly the same code path (see place.spec.ts).
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
})

describe('shouldEmbed', () => {
  const on = { mode: 'work', preferEmbedded: true, current: 'main', currentBlank: false } as const

  it('embeds a real conversation in Chat and Work, and with no mode system at all, once the preference is on', () => {
    expect(shouldEmbed(on)).toBe(true)
    expect(shouldEmbed({ ...on, mode: 'chat' })).toBe(true)
    expect(shouldEmbed({ ...on, mode: undefined })).toBe(true)
  })

  it('declines in Code mode, whose column has no conversation to embed', () => {
    expect(shouldEmbed({ ...on, mode: 'code' })).toBe(false)
  })

  it('declines when the preference is off — the default', () => {
    expect(shouldEmbed({ ...on, preferEmbedded: false })).toBe(false)
  })

  it('declines with no conversation to embed', () => {
    expect(shouldEmbed({ ...on, current: undefined })).toBe(false)
  })

  it('declines a blank conversation, whose log has nothing to carry', () => {
    expect(shouldEmbed({ ...on, currentBlank: true })).toBe(false)
  })
})

describe('activeModeOf', () => {
  it('names the active segment', () => {
    expect(activeModeOf([
      { id: 'chat', active: false },
      { id: 'work', active: true },
      { id: 'code', active: false },
    ])).toBe('work')
  })

  it('returns undefined when none is active', () => {
    expect(activeModeOf([{ id: 'chat', active: false }])).toBeUndefined()
  })
})

describe('loadRemembered', () => {
  it('is a first visit when nothing is stored', () => {
    expect(loadRemembered()).toBeUndefined()
  })

  it('reads a pre-embed record — a bare id — as preference off, saved', () => {
    localStorage.setItem(STORAGE_KEY, 'some-session')
    expect(loadRemembered()).toEqual({ sessionId: 'some-session', embed: false, saved: true })
  })

  it('round-trips the full record', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', parent: 'main', embed: false, saved: false }))
    expect(loadRemembered()).toEqual({ sessionId: 'side', parent: 'main', embed: false, saved: false })
  })

  it('reads a pre-save record without the saved flag as saved', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false }))
    expect(loadRemembered()).toEqual({ sessionId: 'side', embed: false, saved: true })
  })

  it('treats an unparsable record as a first visit', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadRemembered()).toBeUndefined()
  })
})

describe('Sidecar', () => {
  it('connects a plain hidden session by default, even with a real conversation to embed', async () => {
    const { fork, createSession, archiveSession, deps: d } = deps({ current: 'main', byId: { main: row(false) } })
    const sidecar = new Sidecar(d)

    const id = await sidecar.ensure()

    expect(id).toBe('blank-chat-ws')
    expect(fork).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'chat-ws' })
    expect(archiveSession).toHaveBeenCalledWith('blank-chat-ws')
    expect(sidecar.parent()).toBeUndefined()
    expect(sidecar.saved()).toBe(false)
  })

  it('connects a plain hidden session in Code mode', async () => {
    const { fork, createSession, deps: d } = deps({
      current: 'main', byId: { main: row(false) }, mode: () => 'code',
    })
    const sidecar = new Sidecar(d)

    const id = await sidecar.ensure()

    expect(id).toBe('blank-chat-ws')
    expect(fork).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'chat-ws' })
    expect(sidecar.parent()).toBeUndefined()
  })

  it('connects a plain session for a blank supervised conversation', async () => {
    const { fork, deps: d } = deps({ current: 'main', byId: { main: row(true) } })
    const sidecar = new Sidecar(d)

    await sidecar.ensure()

    expect(fork).not.toHaveBeenCalled()
    expect(sidecar.parent()).toBeUndefined()
  })

  it('reuses its own still-blank conversation instead of creating another', async () => {
    let byId: Record<string, { blank: boolean }> = {}
    const { createSession, deps: d } = deps({ byId: () => byId })
    const sidecar = new Sidecar(d)
    await sidecar.ensure()

    byId = { 'blank-chat-ws': row(true) }
    await sidecar.fresh()

    expect(sidecar.current()).toBe('blank-chat-ws')
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('reads a hide the host refused as already saved', async () => {
    const { deps: d } = deps({ archiveSession: vi.fn(async () => false) })
    const sidecar = new Sidecar(d)

    await sidecar.ensure()

    expect(sidecar.saved()).toBe(true)
  })

  it('falls back to a plain session and reports when the fork fails', async () => {
    const onEmbedFallback = vi.fn()
    const { createSession, deps: d } = deps({
      current: 'main',
      byId: { main: row(false) },
      fork: vi.fn(async () => { throw new Error('host refused') }),
      onEmbedFallback,
    })
    const sidecar = new Sidecar(d)

    // The preference is off by default; turning it ON is what asks for a fork.
    const id = await sidecar.toggleEmbedded()

    expect(id).toBe('blank-chat-ws')
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'chat-ws' })
    expect(onEmbedFallback).toHaveBeenCalledWith({ code: 'embed-failed', message: expect.any(String) })
    expect(sidecar.parent()).toBeUndefined()
  })

  it('hides an embedded fork like any fresh conversation', async () => {
    const { fork, archiveSession, deps: d } = deps({ current: 'main', byId: { main: row(false) } })
    const sidecar = new Sidecar(d)

    await sidecar.toggleEmbedded()

    expect(fork).toHaveBeenCalledWith({ sessionId: 'main' })
    expect(archiveSession).toHaveBeenCalledWith('child-of-main')
    expect(sidecar.saved()).toBe(false)
  })

  it('toggles the preference and starts over under it', async () => {
    const { fork, createSession, deps: d } = deps({ current: 'main', byId: { main: row(false) } })
    const sidecar = new Sidecar(d)
    await sidecar.ensure()
    expect(sidecar.parent()).toBeUndefined()
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'chat-ws' })

    // ON: a fresh fork of the conversation still being supervised.
    await sidecar.toggleEmbedded()
    expect(sidecar.prefersEmbedded()).toBe(true)
    expect(sidecar.current()).toBe('child-of-main')
    expect(sidecar.parent()).toBe('main')
    expect(fork).toHaveBeenCalledTimes(1)

    // OFF: the embedded context leaves the window — a plain new session.
    await sidecar.toggleEmbedded()
    expect(sidecar.prefersEmbedded()).toBe(false)
    expect(sidecar.parent()).toBeUndefined()
    expect(createSession).toHaveBeenCalledTimes(2)
  })

  it('adopts the remembered conversation, its parent, its preference and its saved state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'remembered', parent: 'main', embed: false, saved: true }))
    const { deps: d } = deps({ byId: { remembered: row(false) } })
    const sidecar = new Sidecar(d)

    sidecar.restore()

    expect(sidecar.current()).toBe('remembered')
    expect(sidecar.parent()).toBe('main')
    expect(sidecar.prefersEmbedded()).toBe(false)
    expect(sidecar.saved()).toBe(true)
  })

  it('saves the conversation by forking it into the sidebar and talking on', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false, saved: false }))
    const { fork, deps: d } = deps({ byId: { side: row(false) } })
    const sidecar = new Sidecar(d)
    sidecar.restore()

    const id = await sidecar.save()

    expect(id).toBe('child-of-side')
    expect(fork).toHaveBeenCalledWith({ sessionId: 'side' })
    expect(sidecar.current()).toBe('child-of-side')
    expect(sidecar.saved()).toBe(true)
  })

  it('keeps the embed lineage on the saved branch', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', parent: 'main', embed: true, saved: false }))
    const { deps: d } = deps({ byId: { side: row(false) } })
    const sidecar = new Sidecar(d)
    sidecar.restore()

    await sidecar.save()

    expect(sidecar.parent()).toBe('main')
    expect(sidecar.prefersEmbedded()).toBe(true)
  })

  it('save is a no-op once the conversation is already saved', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false, saved: true }))
    const { fork, deps: d } = deps({ byId: { side: row(false) } })
    const sidecar = new Sidecar(d)
    sidecar.restore()

    const id = await sidecar.save()

    expect(id).toBe('side')
    expect(fork).not.toHaveBeenCalled()
  })

  it('save refuses a blank conversation and one that is running', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false, saved: false }))
    const { fork, deps: d } = deps({ byId: { side: { blank: true } } })
    const sidecar = new Sidecar(d)
    sidecar.restore()

    expect(await sidecar.save()).toBeUndefined()

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false, saved: false }))
    const busy = deps({ byId: { side: { blank: false, running: true } } })
    const other = new Sidecar(busy.deps)
    other.restore()

    expect(await other.save()).toBeUndefined()
    expect(fork).not.toHaveBeenCalled()
    expect(busy.fork).not.toHaveBeenCalled()
  })

  it('reports a save the host refused, and keeps offering', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', embed: false, saved: false }))
    const onSaveFailed = vi.fn()
    const { deps: d } = deps({
      byId: { side: row(false) },
      fork: vi.fn(async () => { throw new Error('host refused') }),
      onSaveFailed,
    })
    const sidecar = new Sidecar(d)
    sidecar.restore()

    const id = await sidecar.save()

    expect(id).toBeUndefined()
    expect(onSaveFailed).toHaveBeenCalledWith({ code: 'save-failed', message: expect.any(String) })
    expect(sidecar.current()).toBe('side')
    expect(sidecar.saved()).toBe(false)
  })
})
