/**
 * The source is where the panel's reading of a side conversation is arranged,
 * and where the one thing the harness does not do for an unstaged session —
 * pull its history — has to be asked for. A conversation that came back from a
 * reload looking empty is the failure this file exists to prevent.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { TranscriptSource } from '../src/client/transcript-source.ts'
import type { SidecarIdentity } from '../src/client/transcript-source.ts'

/** A session face: what it holds, who is watching, and whether its window was asked for. */
function face(snapshot: Partial<ConversationSnapshot> = {}, opts: { opens?: boolean } = {}) {
  const watchers = new Set<() => void>()
  const open = vi.fn().mockResolvedValue(undefined)
  return {
    open: opts.opens === false ? undefined : open,
    openCalls: open,
    subscribe: vi.fn((listener: () => void) => {
      watchers.add(listener)
      return () => watchers.delete(listener)
    }),
    getSnapshot: () => snapshot as ConversationSnapshot,
    /** Speak as the runtime would when the window lands or a token arrives. */
    notify: () => { for (const watcher of [...watchers]) watcher() },
  }
}

/** A sessions service over a fixed binding table, plus its list feed. */
function sessionsOver(bindings: Record<string, ReturnType<typeof face>>) {
  const listWatchers = new Set<() => void>()
  const sessions = {
    binding: (id: string) => {
      const session = bindings[id]
      return session === undefined ? undefined : { session }
    },
    list: {
      getSnapshot: () => ({}),
      subscribe: (listener: () => void) => {
        listWatchers.add(listener)
        return () => listWatchers.delete(listener)
      },
    },
  } as unknown as ISessions
  return { sessions, listFrame: () => { for (const watcher of [...listWatchers]) watcher() } }
}

/** The sidecar half: an identity that can change under the source. */
function identity(first: string | undefined) {
  const watchers = new Set<() => void>()
  let id = first
  return {
    identity: {
      current: () => id,
      subscribe: (listener: () => void) => {
        watchers.add(listener)
        return () => watchers.delete(listener)
      },
    } satisfies SidecarIdentity,
    become: (next: string | undefined) => {
      id = next
      for (const watcher of [...watchers]) watcher()
    },
  }
}

describe('TranscriptSource', () => {
  it('pulls the history window of the conversation it binds to', () => {
    // The whole bug in one line: nothing else in the harness opens this
    // session, because opening follows staging and this one is never staged.
    const side = face({ blank: false })
    const { sessions } = sessionsOver({ side })
    const source = new TranscriptSource(sessions, identity('side').identity)

    source.subscribe(() => {})

    expect(side.openCalls).toHaveBeenCalledTimes(1)
  })

  it('is already watching when the window lands', () => {
    const side = face()
    const { sessions } = sessionsOver({ side })
    const source = new TranscriptSource(sessions, identity('side').identity)
    const heard = vi.fn()

    source.subscribe(heard)
    // A subscription taken after the pull would sleep through exactly the
    // change the pull exists to produce.
    expect(side.subscribe.mock.invocationCallOrder[0])
      .toBeLessThan(side.openCalls.mock.invocationCallOrder[0] as number)

    side.notify()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('pulls the window of a conversation New Chat swapped in', () => {
    const first = face()
    const second = face()
    const { sessions } = sessionsOver({ first, second })
    const sidecar = identity('first')
    const source = new TranscriptSource(sessions, sidecar.identity)

    source.subscribe(() => {})
    sidecar.become('second')

    expect(second.openCalls).toHaveBeenCalledTimes(1)
    expect(first.openCalls).toHaveBeenCalledTimes(1)
  })

  it('pulls once per conversation, not once per subscriber', () => {
    const side = face()
    const { sessions } = sessionsOver({ side })
    const source = new TranscriptSource(sessions, identity('side').identity)

    source.subscribe(() => {})
    source.subscribe(() => {})

    expect(side.openCalls).toHaveBeenCalledTimes(1)
  })

  it('pulls when the binding for a just-connected conversation arrives', () => {
    const side = face()
    const bindings: Record<string, ReturnType<typeof face>> = {}
    const { sessions, listFrame } = sessionsOver(bindings)
    const source = new TranscriptSource(sessions, identity('side').identity)

    source.subscribe(() => {})
    expect(side.openCalls).not.toHaveBeenCalled()

    // The id was known before the list frame carrying its row landed.
    bindings['side'] = side
    listFrame()

    expect(side.openCalls).toHaveBeenCalledTimes(1)
  })

  it('leaves a face that does not offer the verb exactly as it found it', () => {
    // A deployment on a harness this was not compiled against: no window, but
    // a live panel rather than a thrown one.
    const side = face({}, { opens: false })
    const { sessions } = sessionsOver({ side })
    const source = new TranscriptSource(sessions, identity('side').identity)

    expect(() => source.subscribe(() => {})).not.toThrow()
    expect(source.getSnapshot()).toBeDefined()
  })

  it('reads the bound conversation, and nothing when none is bound', () => {
    const side = face({ blank: false })
    const { sessions } = sessionsOver({ side })
    const sidecar = identity('side')
    const source = new TranscriptSource(sessions, sidecar.identity)

    source.subscribe(() => {})
    expect(source.getSnapshot()).toMatchObject({ blank: false })

    sidecar.become(undefined)
    expect(source.getSnapshot()).toBeUndefined()
  })
})
