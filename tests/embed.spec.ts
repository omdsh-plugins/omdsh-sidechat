// @vitest-environment jsdom
/**
 * The embed rule and the sidecar's half of it.
 *
 * The pure decision function is the whole policy — when a new side
 * conversation is a fork of the one being supervised — checked without a
 * browser, the same discipline `transcript.ts` applies to the display rule.
 * The Sidecar cases then check the two things the decision cannot: that the
 * fork verb is what actually creates the session, and that a failed fork
 * falls back to the plain connect rather than failing the summon.
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
  byId?: Record<string, { blank: boolean }>
  mode?: () => string | undefined
  fork?: (opts: { sessionId: string }) => Promise<string>
  connectWorkspace?: (id: string) => Promise<string>
  items?: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[]
  onEmbedFallback?: SidecarDeps['onEmbedFallback']
} = {}) {
  const fork = overrides.fork ?? vi.fn(async ({ sessionId }: { sessionId: string }) => `child-of-${sessionId}`)
  const connectWorkspace = overrides.connectWorkspace ?? vi.fn(async (id: string) => `blank-${id}`)
  const sessions = {
    list: {
      getSnapshot: () => ({ current: overrides.current, byId: overrides.byId ?? {} }),
    },
    fork,
  } as unknown as ISessions
  const workspaces = {
    list: {
      getSnapshot: () => ({
        items: overrides.items ?? [{ workspaceId: 'chat-ws', title: 'Chat', sessionIds: [] }],
      }),
    },
    connectWorkspace,
  } as unknown as IWorkspaces
  return {
    fork,
    connectWorkspace,
    deps: {
      sessions,
      workspaces,
      mode: overrides.mode ?? (() => 'work'),
      ...(overrides.onEmbedFallback === undefined ? {} : { onEmbedFallback: overrides.onEmbedFallback }),
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

  it('embeds a real conversation in Chat and Work, and with no mode system at all', () => {
    expect(shouldEmbed(on)).toBe(true)
    expect(shouldEmbed({ ...on, mode: 'chat' })).toBe(true)
    expect(shouldEmbed({ ...on, mode: undefined })).toBe(true)
  })

  it('declines in Code mode, whose column has no conversation to embed', () => {
    expect(shouldEmbed({ ...on, mode: 'code' })).toBe(false)
  })

  it('declines when the preference is off', () => {
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

  it('reads a pre-embed record — a bare id — as preference on, no parent', () => {
    localStorage.setItem(STORAGE_KEY, 'some-session')
    expect(loadRemembered()).toEqual({ sessionId: 'some-session', embed: true })
  })

  it('round-trips the full record', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'side', parent: 'main', embed: false }))
    expect(loadRemembered()).toEqual({ sessionId: 'side', parent: 'main', embed: false })
  })

  it('treats an unparsable record as a first visit', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadRemembered()).toBeUndefined()
  })
})

describe('Sidecar', () => {
  it('connects as a fork of the supervised conversation by default', async () => {
    const { fork, connectWorkspace, deps: d } = deps({ current: 'main', byId: { main: row(false) } })
    const sidecar = new Sidecar(d)

    const id = await sidecar.ensure()

    expect(id).toBe('child-of-main')
    expect(fork).toHaveBeenCalledWith({ sessionId: 'main' })
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(sidecar.parent()).toBe('main')
  })

  it('connects a plain session in Code mode', async () => {
    const { fork, connectWorkspace, deps: d } = deps({
      current: 'main', byId: { main: row(false) }, mode: () => 'code',
    })
    const sidecar = new Sidecar(d)

    const id = await sidecar.ensure()

    expect(id).toBe('blank-chat-ws')
    expect(fork).not.toHaveBeenCalled()
    expect(connectWorkspace).toHaveBeenCalledWith('chat-ws')
    expect(sidecar.parent()).toBeUndefined()
  })

  it('skips the fork for a blank supervised conversation', async () => {
    const { fork, deps: d } = deps({ current: 'main', byId: { main: row(true) } })
    const sidecar = new Sidecar(d)

    await sidecar.ensure()

    expect(fork).not.toHaveBeenCalled()
    expect(sidecar.parent()).toBeUndefined()
  })

  it('falls back to a plain session and reports when the fork fails', async () => {
    const onEmbedFallback = vi.fn()
    const { connectWorkspace, deps: d } = deps({
      current: 'main',
      byId: { main: row(false) },
      fork: vi.fn(async () => { throw new Error('host refused') }),
      onEmbedFallback,
    })
    const sidecar = new Sidecar(d)

    const id = await sidecar.ensure()

    expect(id).toBe('blank-chat-ws')
    expect(connectWorkspace).toHaveBeenCalledWith('chat-ws')
    expect(onEmbedFallback).toHaveBeenCalledWith({ code: 'embed-failed', message: expect.any(String) })
    expect(sidecar.parent()).toBeUndefined()
  })

  it('toggles the preference and starts over under it', async () => {
    const { fork, connectWorkspace, deps: d } = deps({ current: 'main', byId: { main: row(false) } })
    const sidecar = new Sidecar(d)
    await sidecar.ensure()
    expect(sidecar.parent()).toBe('main')

    // OFF: the embedded context leaves the window — a plain new session.
    await sidecar.toggleEmbedded()
    expect(sidecar.prefersEmbedded()).toBe(false)
    expect(sidecar.parent()).toBeUndefined()
    expect(connectWorkspace).toHaveBeenCalledWith('chat-ws')

    // ON again: a fresh fork of the conversation still being supervised.
    await sidecar.toggleEmbedded()
    expect(sidecar.prefersEmbedded()).toBe(true)
    expect(sidecar.current()).toBe('child-of-main')
    expect(sidecar.parent()).toBe('main')
    expect(fork).toHaveBeenCalledTimes(2)
  })

  it('adopts the remembered conversation, its parent and its preference', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: 'remembered', parent: 'main', embed: false }))
    const { deps: d } = deps({ byId: { remembered: row(false) } })
    const sidecar = new Sidecar(d)

    sidecar.restore()

    expect(sidecar.current()).toBe('remembered')
    expect(sidecar.parent()).toBe('main')
    expect(sidecar.prefersEmbedded()).toBe(false)
  })
})
