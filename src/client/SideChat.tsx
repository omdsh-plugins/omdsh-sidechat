/**
 * The side conversation, on the frame's floating overlay layer.
 *
 * A whole conversation, not a send box: header, transcript, composer. What it
 * shows is deliberately less than the harness's own column — asks and answers,
 * and one line while the model works — because the two surfaces are for
 * different things. That column is where you supervise work; this is where you
 * ask a question and read the answer without any of the work you are
 * supervising moving out from under you.
 *
 * It is not modal and there is no backdrop. Selecting, scrolling and reading go
 * on underneath while it stands, which is the point: the thing you are asking
 * about must remain visible while you ask.
 *
 * Everything it draws comes from the harness's own primitives — `MarkdownText`
 * for answers, `MessageText` for your own words, alias variables for every
 * colour — so it reads as part of dsh rather than as a plugin's idea of dsh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  IconBranchOutline16, IconCheckOutline16, IconCloseOutline16, IconDownloadOutline16,
  IconNewChatOutline16, IconRightUpOutline16,
  MarkdownText, MessageText, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { toAssistantBlocks } from '@deepseek-ai/dsh-client-runtime/client'
import { SIDECHAT_ROOT_ATTR } from '../conventions.ts'
import { anchorLabel, clampExcerpt } from './compose.ts'
import type { SideChatProps } from './contract.ts'
import type { SendMode } from './deliver.ts'
import type { Placement } from './place.ts'
import { BOX_HEIGHT, BOX_SIZE, BOX_WIDTH, clampPlacement, dragTo } from './place.ts'
import { projectTranscript } from './transcript.ts'
import css from './SideChat.module.css'

/**
 * Render the side conversation.
 * @param props - composed slot props (contract.ts).
 * @returns the panel, or null while it is dismissed.
 */
export function SideChat({
  useSideChat, useSessions, useTranscript,
  submit, retarget, moveTo, newChat, toggleEmbed, showInChat, save, close, clearNotice, t,
}: SideChatProps) {
  const open = useSideChat(state => state.open)
  const anchor = useSideChat(state => state.anchor)
  const position = useSideChat(state => state.position)
  const notice = useSideChat(state => state.notice)
  const sessionId = useSideChat(state => state.sessionId)
  const embedOn = useSideChat(state => state.embedOn)
  const embedParent = useSideChat(state => state.embedParent)
  const embeddable = useSideChat(state => state.embeddable)
  const saved = useSideChat(state => state.saved)

  // Primitive selections on purpose: a selector returning a fresh object would
  // re-render this tree on every streaming update of the session list.
  const sourceCwd = useSessions(state => (state.current === undefined ? undefined : state.byId[state.current]?.cwd))
  const targetCwd = useSessions(state => (sessionId === undefined ? undefined : state.byId[sessionId as never]?.cwd))
  const running = useSessions(state => (sessionId === undefined ? false : state.byId[sessionId as never]?.running === true))
  // Blank means no turn has run: there is nothing to save, and saving then
  // would put a blank session in the workspace account for New Session to
  // reuse. Unknown ids read blank, which is also unsaveable.
  const blank = useSessions(state => (sessionId === undefined ? true : state.byId[sessionId as never]?.blank !== false))
  const parentTitle = useSessions(state => (
    embedParent === undefined ? undefined : state.byId[embedParent as never]?.title
  ))

  const snapshot = useTranscript(state => state)
  // The runtime's own classifier: the display rule lives in transcript.ts,
  // which takes it as a parameter so that rule stays checkable without one.
  const view = useMemo(() => projectTranscript(snapshot, toAssistantBlocks), [snapshot])

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ x: number; y: number; from: Placement } | null>(null)

  useEffect(() => { if (open) draftRef.current?.focus() }, [open])

  // Follow the conversation as it grows. `block: 'nearest'` keeps the page
  // itself still — this scrolls the transcript, never the app behind it.
  useEffect(() => {
    if (open) tailRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, view.turns.length, view.streaming, view.diving])

  // Summon first, decide what you are asking about second.
  useEffect(() => {
    if (!open) return undefined
    const onSelectionChange = (): void => { retarget() }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => { document.removeEventListener('selectionchange', onSelectionChange) }
  }, [open, retarget])

  const clamped = useMemo(
    () => (anchor.excerpt === undefined ? undefined : clampExcerpt(anchor.excerpt)),
    [anchor],
  )

  const send = useCallback((mode: SendMode) => {
    const question = draft.trim()
    if (question === '' || sending) return
    setSending(true)
    clearNotice()
    // Cleared up front: the question belongs to the transcript now, and a
    // draft left in the box reads as one that did not go.
    setDraft('')
    void submit(question, mode).finally(() => { setSending(false) })
  }, [draft, sending, submit, clearNotice])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    send(event.metaKey || event.ctrlKey ? 'steer' : 'queue')
  }, [send])

  // Dragging by the header. Pointer capture rather than window listeners, so
  // the panel keeps receiving moves even when the pointer outruns it, and the
  // browser's own text selection never starts underneath the gesture.
  const onDragStart = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // The buttons in this row are not a handle.
    if ((event.target as Element).closest('button') !== null) return
    if (position === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, from: position }
  }, [position])

  const onDragMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const started = drag.current
    if (started === null) return
    moveTo(dragTo(
      started.from,
      event.clientX - started.x,
      event.clientY - started.y,
      { width: window.innerWidth, height: window.innerHeight },
      BOX_SIZE,
    ))
  }, [moveTo])

  const onDragEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current === null) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const label = anchorLabel(anchor, sourceCwd, targetCwd)
  // Clamped on read: a window resized smaller must not leave the header — the
  // only way to drag the panel back — off the screen.
  const placement = position === undefined
    ? { left: 0, top: 0 }
    : clampPlacement(position, { width: window.innerWidth, height: window.innerHeight }, BOX_SIZE)

  // The button's state and its promise, in one line: what pressing it will do
  // is exactly what the state it shows is not.
  const embedTip = !embeddable
    ? t('embed.unavailable')
    : embedOn
      ? (parentTitle === undefined ? t('embed.onUntitled') : t('embed.on', { title: parentTitle }))
      : t('embed.off')

  // What the save control explains, and why it can refuse: it saves a hidden
  // conversation into the sidebar, and a refusal is always the answer still
  // moving or nothing said yet.
  const saveTip = saved
    ? t('save.doneHint')
    : running
      ? t('save.runningHint')
      : blank
        ? t('save.blankHint')
        : t('save.hint')

  if (!open || position === undefined) return null

  return (
    <section
      className={css.panel}
      style={{ left: placement.left, top: placement.top, width: BOX_WIDTH, height: BOX_HEIGHT }}
      role="dialog"
      aria-label={t('title')}
      {...{ [SIDECHAT_ROOT_ATTR]: '' }}
    >
      <header
        className={css.head}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className={css.title}>{t('title')}</span>
        <Tooltip label={embedTip} side="bottom" delayMs={500}>
          <button
            type="button"
            className={embedOn ? `${css.headBtn} ${css.headBtnOn}` : css.headBtn}
            onClick={toggleEmbed}
            disabled={!embeddable}
            aria-pressed={embedOn}
            aria-label={t('embed.label')}
          >
            <IconBranchOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('showInChat')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.headBtn}
            onClick={showInChat}
            disabled={sessionId === undefined}
            aria-label={t('showInChat')}
          >
            <IconRightUpOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('newChat')} side="bottom" delayMs={500}>
          <button type="button" className={css.headBtn} onClick={newChat} aria-label={t('newChat')}>
            <IconNewChatOutline16 />
          </button>
        </Tooltip>
        <button type="button" className={css.headBtn} onClick={close} aria-label={t('close')}>
          <IconCloseOutline16 />
        </button>
      </header>

      <div className={css.scroll}>
        {view.empty && <p className={css.blank}>{t('blank')}</p>}

        {view.turns.map(turn => (
          <div key={turn.key} className={turn.kind === 'ask' ? css.ask : css.answer}>
            {turn.kind === 'ask'
              ? <MessageText text={turn.text} />
              : <MarkdownText text={turn.text} />}
            {turn.kind === 'answer' && turn.interrupted && <span className={css.stopped}>{t('stopped')}</span>}
          </div>
        ))}

        {view.streaming !== undefined && (
          <div className={css.answer}>
            <MarkdownText text={view.streaming} streaming />
          </div>
        )}

        {/*
          The whole apparatus — reasoning, tool calls, results — is this one
          line. Which tool is running is exactly the detail this surface
          promises not to carry.
        */}
        {view.diving && <p className={css.diving}>{t('diving')}</p>}

        <div ref={tailRef} />
      </div>

      <footer className={css.foot}>
        {label !== undefined && <span className={css.chip} title={label}>{label}</span>}
        {label === undefined && anchor.excerpt !== undefined && (
          <span className={`${css.chip} ${css.chipPlain}`}>{t('anchor.selection')}</span>
        )}
        {clamped !== undefined && (clamped.omitted > 0 || clamped.clipped) && (
          <span className={css.note}>
            {clamped.omitted > 0 ? t('excerpt.omitted', { count: clamped.omitted }) : t('excerpt.clipped')}
          </span>
        )}

        <textarea
          ref={draftRef}
          className={css.draft}
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={onKeyDown}
          placeholder={t('placeholder')}
          rows={2}
          disabled={sending}
        />

        <div className={css.status}>
          <span className={notice === undefined ? css.hint : `${css.hint} ${css.error}`}>
            {notice !== undefined
              ? (notice.code === 'embed-failed'
                ? t('embed.failed')
                : notice.code === 'save-failed'
                  ? t('save.failed')
                  : t('failed', { code: notice.code }))
              : sessionId === undefined
                ? t('connecting')
                : running ? t('status.queue') : t('status.idle')}
          </span>
          {running && notice === undefined && <span className={css.hint}>{t('status.steerHint')}</span>}
          {/*
            The corner of the panel, and the one control that is not about
            asking: the conversation stays out of the sidebar until this is
            pressed, and its done state is the answer.
          */}
          <Tooltip label={saveTip} side="top" delayMs={500}>
            <button
              type="button"
              className={saved ? `${css.saveBtn} ${css.saveBtnDone}` : css.saveBtn}
              onClick={save}
              disabled={sessionId === undefined || saved || blank || running}
              aria-pressed={saved}
              aria-label={t('save.label')}
            >
              {saved ? <IconCheckOutline16 /> : <IconDownloadOutline16 />}
              <span>{saved ? t('save.done') : t('save.label')}</span>
            </button>
          </Tooltip>
        </div>
      </footer>
    </section>
  )
}
