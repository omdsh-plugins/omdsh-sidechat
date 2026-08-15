/**
 * The display rule is the product here: what a side conversation shows and
 * what it swallows. Every case below is a promise the panel makes.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClassifyContent } from '../src/client/transcript.ts'
import { EMPTY_TRANSCRIPT, projectTranscript, visibleText } from '../src/client/transcript.ts'

/**
 * Stand-in for the runtime's `toAssistantBlocks`. The real one is passed in
 * production; the rule under test does not depend on which.
 */
const classify: ClassifyContent = content =>
  content.map(block => ({ kind: 'text', text: (block as { text?: string }).text ?? '' }))

/**
 * A snapshot with just the fields this projection reads. `blank: true` is the
 * default the runtime itself starts a session face on — an empty log until the
 * host summary says otherwise.
 */
function snapshot(fields: Partial<ConversationSnapshot>): ConversationSnapshot {
  return { nodes: [], partial: null, running: false, blank: true, ...fields } as unknown as ConversationSnapshot
}

/** A user node. */
function ask(seq: number, text: string): unknown {
  return { kind: 'user', seq, time: 0, content: [{ type: 'text', text }], source: null }
}

/** An assistant node carrying the given blocks. */
function answer(seq: number, blocks: unknown[], interrupted?: true): unknown {
  return { kind: 'assistant', seq, time: 0, turn: 1, step: 1, blocks, ...(interrupted === undefined ? {} : { interrupted }) }
}

const text = (value: string) => ({ kind: 'text', text: value })
const reasoning = (value: string) => ({ kind: 'reasoning', text: value })
const toolCall = (name: string) => ({ kind: 'tool-call', callId: 'c1', name, argsRaw: '{}' })

describe('visibleText', () => {
  it('keeps text blocks and drops everything else', () => {
    expect(visibleText([reasoning('let me think'), text('  the answer  '), toolCall('read')] as never))
      .toBe('the answer')
  })

  it('joins split text without inserting anything between the pieces', () => {
    expect(visibleText([text('half a '), text('sentence')] as never)).toBe('half a sentence')
  })

  it('is empty for a step that only thought and called tools', () => {
    expect(visibleText([reasoning('hmm'), toolCall('grep')] as never)).toBe('')
  })
})

describe('projectTranscript', () => {
  it('has nothing to show before a session exists', () => {
    expect(projectTranscript(undefined, classify)).toBe(EMPTY_TRANSCRIPT)
  })

  it('pairs asks with answers', () => {
    const view = projectTranscript(snapshot({
      nodes: [ask(1, 'why?'), answer(2, [text('because')])] as never,
    }), classify)

    expect(view.turns).toEqual([
      { kind: 'ask', key: 'u1', text: 'why?' },
      { kind: 'answer', key: 'a2', text: 'because', interrupted: false },
    ])
    expect(view.empty).toBe(false)
  })

  it('never shows the thinking, not even collapsed', () => {
    const view = projectTranscript(snapshot({
      nodes: [answer(2, [reasoning('a long private deliberation'), text('42')])] as never,
    }), classify)

    expect(view.turns).toEqual([{ kind: 'answer', key: 'a2', text: '42', interrupted: false }])
    expect(JSON.stringify(view)).not.toContain('deliberation')
  })

  it('drops a step that produced only tool calls instead of showing a blank answer', () => {
    const view = projectTranscript(snapshot({
      nodes: [ask(1, 'find it'), answer(2, [toolCall('grep')]), answer(3, [text('found')])] as never,
    }), classify)

    expect(view.turns.map(turn => turn.key)).toEqual(['u1', 'a3'])
  })

  it('drops every node kind this surface does not carry', () => {
    const view = projectTranscript(snapshot({
      nodes: [
        { kind: 'steering', seq: 1 }, { kind: 'tool-result', seq: 2 },
        { kind: 'command', seq: 3 }, { kind: 'turn-error', seq: 4 },
        ask(5, 'still here'),
      ] as never,
    }), classify)

    expect(view.turns).toEqual([{ kind: 'ask', key: 'u5', text: 'still here' }])
  })

  it('says Deep diving while it works with nothing to show yet', () => {
    const view = projectTranscript(snapshot({
      nodes: [ask(1, 'why?')] as never,
      running: true,
      partial: { turn: 1, step: 1, blocks: [reasoning('thinking'), toolCall('read')] } as never,
    }), classify)

    expect(view.diving).toBe(true)
    expect(view.streaming).toBeUndefined()
  })

  it('stops diving the moment answer text starts arriving', () => {
    const view = projectTranscript(snapshot({
      running: true,
      partial: { turn: 1, step: 1, blocks: [reasoning('thinking'), text('the ans')] } as never,
    }), classify)

    expect(view.diving).toBe(false)
    expect(view.streaming).toBe('the ans')
  })

  it('is not diving when nothing is running', () => {
    expect(projectTranscript(snapshot({ running: false }), classify).diving).toBe(false)
  })

  it('marks an answer that was cut off', () => {
    const view = projectTranscript(snapshot({
      nodes: [answer(2, [text('half of it')], true)] as never,
    }), classify)

    expect(view.turns[0]).toMatchObject({ kind: 'answer', interrupted: true })
  })

  it('is empty for a conversation that has not started', () => {
    expect(projectTranscript(snapshot({}), classify).empty).toBe(true)
  })

  it('is not empty while it is working, even before the first word', () => {
    expect(projectTranscript(snapshot({ running: true }), classify).empty).toBe(false)
  })

  it('does not introduce itself to a conversation whose history has not arrived', () => {
    // A remembered conversation, bound again after a reload: the host says its
    // log is not empty, and the window has not been installed yet.
    const view = projectTranscript(snapshot({ blank: false, openState: 'loading' as never }), classify)

    expect(view.turns).toEqual([])
    expect(view.empty).toBe(false)
  })

  it('stays quiet for a conversation whose every node this surface drops', () => {
    const view = projectTranscript(snapshot({
      blank: false,
      nodes: [answer(2, [toolCall('grep')])] as never,
    }), classify)

    expect(view.turns).toEqual([])
    expect(view.empty).toBe(false)
  })
})
