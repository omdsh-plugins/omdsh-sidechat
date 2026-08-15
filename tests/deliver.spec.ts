/**
 * Delivery is where a mistake is expensive: a dropped anchor is a question
 * about nothing, and a swallowed failure is a question the person believes
 * they asked.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { Anchor } from '../src/client/anchor.ts'
import { cwdOf, deliver, isCommandLine, targetOf } from '../src/client/deliver.ts'
import type { Target } from '../src/client/deliver.ts'

/**
 * A session list holding the work conversation and the side one — the ordinary
 * arrangement, since the two live in different workspaces.
 */
function list(rows: Record<string, { running?: boolean; cwd?: string }>, current?: string): SessionListState {
  const byId: Record<string, unknown> = {}
  for (const [id, row] of Object.entries(rows)) {
    byId[id] = { sessionId: id, running: row.running ?? false, ...(row.cwd === undefined ? {} : { cwd: row.cwd }) }
  }
  return { current, ids: Object.keys(rows), byId } as unknown as SessionListState
}

/** A sessions service whose binding hands back the given session face. */
function sessionsWith(session: object): ISessions {
  return { binding: () => ({ session }) } as unknown as ISessions
}

const id = (value: string): Target['sessionId'] => value as Target['sessionId']
const target: Target = { sessionId: id('side'), running: false, cwd: '/chat', sourceCwd: '/w/proj' }
const bare: Anchor = { origin: 'none' }

describe('cwdOf', () => {
  it('reads a session\'s working directory', () => {
    expect(cwdOf(list({ s1: { cwd: '/w/proj' } }), 's1')).toBe('/w/proj')
  })

  it('treats an unrecorded or empty directory as absent', () => {
    expect(cwdOf(list({ s1: {} }), 's1')).toBeUndefined()
    expect(cwdOf(list({ s1: { cwd: '' } }), 's1')).toBeUndefined()
    expect(cwdOf(list({ s1: {} }), undefined)).toBeUndefined()
  })
})

describe('targetOf', () => {
  it('carries both directories: where the answer runs and where the anchor came from', () => {
    const snapshot = list({ work: { cwd: '/w/proj' }, side: { running: true, cwd: '/chat' } }, 'work')

    expect(targetOf(snapshot, id('side'), 'work')).toEqual({
      sessionId: 'side', running: true, cwd: '/chat', sourceCwd: '/w/proj',
    })
  })

  it('reports the SIDE conversation\'s running bit, not the work one\'s', () => {
    // The work session being busy is exactly the situation this plugin exists
    // for; it must not read as "the side chat is busy".
    const snapshot = list({ work: { running: true }, side: { running: false } }, 'work')

    expect(targetOf(snapshot, id('side'), 'work').running).toBe(false)
  })

  it('omits directories nothing recorded rather than inventing them', () => {
    expect(targetOf(list({ side: {} }), id('side'), undefined)).toEqual({
      sessionId: 'side', running: false,
    })
  })
})

describe('isCommandLine', () => {
  it('recognizes a bare slash line', () => {
    expect(isCommandLine('/compact', bare)).toBe(true)
  })

  it('declines once an anchor is attached', () => {
    // The command path takes a line and nothing else, so routing here would
    // silently drop the thing the person pointed at.
    expect(isCommandLine('/compact', { origin: 'element', path: 'src/a.ts' })).toBe(false)
    expect(isCommandLine('/compact', { origin: 'selection', excerpt: 'x' })).toBe(false)
  })

  it('declines a multi-line draft', () => {
    expect(isCommandLine('/compact\nand also', bare)).toBe(false)
  })
})

describe('deliver', () => {
  it('sends the composed prompt in the requested mode', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    const sessions = sessionsWith({ prompt })

    const result = await deliver(sessions, target, { origin: 'element', path: '/w/proj/src/a.ts' }, 'why?', 'steer')

    expect(result).toEqual({ ok: true, as: 'steer' })
    // Absolute, because the side conversation runs in /chat: a path relative
    // to the work directory would name nothing there.
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '/w/proj/src/a.ts\n\nwhy?' }], 'steer')
  })

  it('relativizes when the side conversation shares the work directory', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    const sameDir: Target = { sessionId: id('side'), running: false, cwd: '/w/proj', sourceCwd: '/w/proj' }

    await deliver(sessionsWith({ prompt }), sameDir, { origin: 'element', path: '/w/proj/src/a.ts' }, 'why?', 'queue')

    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'src/a.ts\n\nwhy?' }], 'queue')
  })

  it('reports a business failure instead of throwing it away', async () => {
    const sessions = sessionsWith({
      prompt: vi.fn().mockResolvedValue({ ok: false, error: { code: 'agent-busy', message: 'prompt rejected' } }),
    })

    expect(await deliver(sessions, target, bare, 'hello', 'queue')).toEqual({
      ok: false, code: 'agent-busy', message: 'prompt rejected',
    })
  })

  it('routes a matched command to the dispatcher and never to the model', async () => {
    const prompt = vi.fn()
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })

    const result = await deliver(sessionsWith({ prompt, command }), target, bare, '/compact', 'queue')

    expect(result).toEqual({ ok: true, as: 'command' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('sends an unmatched slash line on as the text it always was', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } })
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: false } })

    const result = await deliver(sessionsWith({ prompt, command }), target, bare, '/notacommand', 'queue')

    expect(result).toEqual({ ok: true, as: 'queue' })
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '/notacommand' }], 'queue')
  })

  it('reports a conversation that closed underneath it', async () => {
    const sessions = { binding: () => undefined } as unknown as ISessions

    expect(await deliver(sessions, target, bare, 'hello', 'queue')).toMatchObject({
      ok: false, code: 'session-not-found',
    })
  })

  it('folds a carrier fault into a result rather than rejecting', async () => {
    const sessions = sessionsWith({ prompt: vi.fn().mockRejectedValue(new Error('carrier gone')) })

    expect(await deliver(sessions, target, bare, 'hello', 'queue')).toEqual({
      ok: false, code: 'internal', message: 'carrier gone',
    })
  })

  it('refuses an empty draft', async () => {
    const prompt = vi.fn()

    expect(await deliver(sessionsWith({ prompt }), target, bare, '', 'queue')).toMatchObject({ ok: false })
    expect(prompt).not.toHaveBeenCalled()
  })
})
