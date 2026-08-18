# omdsh-sidechat

English | [中文](README.zh.md)

Press ⌘L **anywhere** in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI to open a **conversation of its own**, right where you are. It carries whatever you were looking at as its anchor, and both the question and the answer stay in its own session — the one you are actually running is not touched, context included. That session also **stays out of the sidebar until you save it**; the Save control in the panel's corner is what gives it a row under its workspace. Embedding the context of the conversation you are running is there too — as the branch button in the header, **off by default**: a side conversation is standalone unless you ask it to be a fork.

## What it adds

| Surface | Where it comes from |
|---|---|
| ⌘L anywhere in the app | A window listener this plugin owns, yielded inside text fields, inside any `data-omdsh-sidechat-yield` subtree, and to `omdsh-shortcuts` entirely when that plugin is composed |
| A draggable panel that summons over the app | An entry in `shell.overlay` at order `100`, placed beside the selection and remembered across reloads in localStorage |
| An icon in the session header's utility row | The `conversation.session.header.utilities` list slot at order `105`, inboard of omdsh-sidepanel's switches |
| The same icon when that row is away | An understudy in `shell.overlay` at order `-8`, holding the corner in a blank conversation and in Code mode |
| The `sidechat` service — `registerAnchorSource`, `summonChord`, `setSummonChord` | `ctx.reflect.provide` in the browser half; a panel that knows where it is can say so |
| A hidden side conversation in the `Chat` workspace — or a fork branch of the current conversation — and a Save control that gives it a sidebar row | `ISessions.fork`, the host's `session.create` for a fresh one, `IWorkspaces.archiveSession` for the hide and `ISession.prompt` — the faces the browser already holds, so there is no host half |
| The `sidechat.open` command | Registered with `omdsh-shortcuts` when its `shortcut` service is there, which is also where the icon's tooltip reads its chord |

The harness has one input, at the bottom of the conversation column, and it belongs to the thing you are running. So every "wait, what does this function do?" costs you twice: your hands leave what you were reading, and **the question moves into that conversation's context**, where it stays — taking up window, shaping every turn after it.

This plugin deletes both costs: **summon a conversation of your own, where you already are.**

It is a full session — multi-turn, with history, living in the `Chat` workspace (in the source conversation's workspace when it embeds one). Until it is saved it is **hidden from the sidebar**, and it stays its own thing either way — it just happens to be summoned from beside the line you were pointing at.

## What it shows

A question, an answer, and one line while it works. That is all.

The harness's own column is a **workbench**: reasoning, tool calls, results, plans, retries, every step laid out, because that column is where you supervise. This is not that. This is asking a question and reading the answer, and the whole apparatus in between collapses into three words:

```
you:  Why is this slot's scope session?
      Deep diving...
      Because the view follows the current session, and …
```

- **`text` blocks are the answer**;
- **`reasoning` blocks are never shown** — not collapsed, not behind a disclosure. Dropped;
- **`tool-call` blocks are not shown either**, and a step that only called tools **produces no entry at all**, or the transcript would fill with blank answers;
- **while the model works with nothing to show yet, that is one line: `Deep diving...`**. Which tool is running is exactly the detail this surface promises not to carry.

That rule is a pure function (`transcript.ts`), so it has its own specs — one per sentence above.

Not a byte of the styling is invented here: answers go through the harness's own `MarkdownText`, your words through `MessageText`, every colour is an alias variable. The panel follows the app's theme without this package knowing which theme is on.

## Where it lives

In **a session of its own**, in the host-managed `Chat` workspace — the one [`omdsh-chatmode`](https://github.com/omdsh-plugins/omdsh-chatmode) creates and [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel) derives its mode from, matched here by the **title** a user reads rather than by an import. That is a product fact (it is the group heading in the sidebar), which is how three packages agree on it without depending on each other.

A deployment without the chat plugin has no such workspace; there it opens a second session in **the current conversation's workspace** instead. The two contexts stay apart either way — they just share a directory. This plugin does not quietly become a dependent of that one.

**When it embeds a context, it is a fork.** `sessions.fork` is the harness's own verb for "a conversation carrying this history" — the host-side live-session fork API, the same one the harness's conversation column uses. The child receives the source's full history as its seed, inherits its working directory, and carries the lineage in `parentSessionId`, so the sidebar **nests it under the source conversation**. This plugin copies nothing and writes nothing into the supervised conversation — a fork is a read-only branch.

**Hidden until saved.** Whatever path created it, the conversation is archived the moment it connects — the workspace registry's own verb, which stops every grouping surface from drawing it while its log and its workspace account stay intact. It is not a lightweight scratch pad: it is a real persisted session the sidebar simply agrees not to show. The one exception is a hide the host refused — the conversation stays visible and is treated as saved, because it already has the row Save would have created.

**Remembered across reloads**: the side conversation in use is kept in localStorage — the session id, the conversation it was forked from, the embed preference, and whether it is saved, in one record (a bare id written by an older version is read as "no parent, preference off, saved"; a record from before the save feature reads as saved, since those conversations were never hidden). A remembered id is verified against the session list first — a conversation that was deleted is not an error, it is a conversation that ended.

And **what was said in it comes back too**. The harness pulls a session's history for the session that is on stage, and this one deliberately never is — so the panel asks for its own window when it binds (`transcript-source.ts`). Without that step a remembered conversation returns live but blank: everything said after the reload, nothing said before it.

## The four buttons in the header

**Embed context** — the branch icon, and the conversation's **state** in one control: it shows whether this side conversation currently carries another conversation's context, and it is the switch itself.

- **Lit** (brand blue): this side conversation is a fork of the current conversation, and the context is right there in the window. Pressing it **detaches** — the embedded context leaves the window and a new conversation without it starts; the fork left behind stays hidden, like every unsaved side conversation.
- **Dim**: this conversation is standalone. Pressing it **embeds** — a fork of the conversation being supervised starts as a new side conversation carrying its context.
- **Greyed out in Code mode**: that column is a terminal, there is no "current conversation" to embed. The button is disabled and nothing is ever forked.

Both directions land as **a new conversation**, because a conversation's context is its history — it can neither be grafted in afterwards nor removed in place. Every mode defaults to dim — standalone — and the button is what turns embedding on; Code stays grey; a deployment without `omdsh-basemode` has no mode system and is treated as Chat/Work.

**Open in the Chat window** — jump to this conversation in the main UI. It is an ordinary session already (in the `Chat` workspace, or the source's workspace when it is a fork), so "opening" it is just navigation (`sessions.open`): no export, no copy, no second representation of the same messages. Go there to keep talking at length, or to see the full reasoning and tool calls — that is the workbench, this is the side. Disabled until a conversation is connected. An unsaved conversation opened this way keeps no sidebar row — press Save in the panel first when the conversation should stay findable.

**New chat** — below.

**Close** — dismisses the panel only; the conversation is untouched.

## Save

The control in the panel's bottom-right corner — a small **Save** beside the status line, the one thing in the footer that is not about asking.

Until it is pressed the side conversation has **no row in the sidebar**, in any mode. Pressing it cuts a fork of the hidden conversation: the child carries its history, inherits its working directory and workspace, is **not** hidden — and the panel goes on talking into the child. The hidden original stays hidden. The harness has no "unhide" verb, so a saved conversation is a new branch by construction; nothing is ever lost from the panel's point of view, and the sidebar row appears under the conversation's own workspace — `Chat` for a standalone side, the source's workspace for an embedded one.

Once saved the control reads **Saved** with a check, and stays that way for the life of the conversation. It refuses while the conversation is still blank (there is nothing to save, and a blank session in a workspace account is what the harness reuses for New Session) and while the answer is running (a fork is a snapshot of the last *completed* turn — saving then would drop the turn in flight). A save the host refused keeps the conversation hidden and says so on the status line; the button keeps offering.

## New chat

The button in the panel header. It starts a fresh one; the previous conversation stays where it was — hidden, or in the sidebar when it was saved. **New chat obeys the embed preference**: on, it starts as a new fork of the current conversation; off, it is the blank conversation below.

Underneath the standalone side is a fresh `session.create` in the home workspace, with this plugin's **own blank reuse** — pressing New Chat twice without saying anything leaves you in the same empty conversation rather than littering `Chat` with hidden shells. Same rule the harness's own New Session follows, scoped to this plugin's own conversations: the harness's `connectWorkspace` reuse is deliberately not used, because it can hand back the conversation the person is looking at, and a conversation this panel is about to hide must never be theirs. A fork has no such reuse: a branch is new by construction.

## Where the anchor comes from

An anchor is a fact about a location: a path, a line range, the text you had selected. Each part can be absent on its own.

Registered anchor sources are asked first, newest first. When none answers, the built-in reading takes over — **the browser's own selection**:

- the selected text is the quotation;
- the nearest `data-omdsh-anchor` above the selection is the path;
- the nearest `data-omdsh-anchor-line` above each end gives the lines.

Both attributes are optional and each absence is one step down. With none of them the anchor is empty — the panel still summons and still asks, it simply carries no location.

Those attributes are a **published convention**, the same shape `omdsh-sidepanel` uses when it reaches for `#root` and `[data-slot="conversation"]`: **a published anchor, not a class name and not a DOM shape**, where absence is a skip rather than an error. Making your own panel anchorable costs one attribute.

Four attributes are published in all, and the other two are about who owns an event rather than where a line lives: `data-omdsh-sidechat-yield` marks a subtree that keeps the summon key for itself, and `data-omdsh-sidechat` marks this plugin's own overlay — which is what makes a selection inside the draft "the person re-reading what they typed" rather than a quotation of anything, and what makes the key toggle the panel shut instead of yielding to the textarea under the cursor.

A panel that knows more than the DOM can express can say so directly:

```ts
ctx.sidechat.registerAnchorSource(() => ({ origin: 'element', path: currentFile }))
```

## What it sends

Exactly **one thing crosses** between the two conversations: the anchor, as text. The context does not travel here — it travels as the fork: once the branch is cut, the source's entire history is the new conversation's own, and every question after that is an ordinary line on the branch. `PromptContentPart` is `text` or `image`, so an anchor cannot travel as structure — it travels as the shape a person would have typed:

````
/w/proj/src/client/apply.ts:199-205

```ts
      children: {
        'conversation.view': { kind: 'list', scope: 'session' },
```

Why is this slot's scope session?
````

**Note that it is absolute.** Two working directories are in play and they are usually not the same one: the anchor comes from the workspace you are looking at, a standalone side conversation lives in `Chat`; a fork **inherits the source's working directory**, the two coincide, and the path naturally comes out relative. So the path is rooted against **where it came from** and only then made relative to **where it is going** — relative when both are the same directory, absolute when they are not, neither case special-cased. An absolute path the receiver cannot shorten is the **correct** answer, not a degraded one: it is the only form that still names the right file.

**A quotation is clamped, never streamed.** Past 60 lines the middle goes, past 4096 bytes the tail goes, both say how much was dropped, and both say it **in the panel before you press Enter**.

The clamp markers are English regardless of interface language: they are read by the agent, not by the person.

A draft that is a single line starting with `/` **and carries no anchor** goes to `session.command()`; an unmatched line is sent on as text. A draft WITH an anchor never takes the command path — a command takes one line and nothing else, and silently dropping what you pointed at is the one outcome this surface must never produce.

## Queue or steer

| Side conversation | Enter | ⌘⏎ |
|---|---|---|
| idle | sends | sends |
| answering | `queue` (after the current turn) | `steer` (into the current turn) |

Note that this column is about whether **the side conversation** is busy. Your main session being busy is precisely the situation this plugin exists for; it never reads as "the side chat is busy".

A failed send — a model that will not take the request, a session that has already closed — **keeps the error code**. The question itself is already in the transcript, which is a better acknowledgement than any banner and one that is still readable a minute later.

## Where it sits

`shell.overlay`, ui-layout's frame-wide floating layer. A **list** slot, so standing here costs nobody their seat: `omdsh-sidepanel`'s panels are already there and everyone orders among themselves (panels at `-10`, omdsh-sidepanel's understudy at `-9`, [this plugin's own icon understudy](#and-where-it-goes-when-that-row-is-away) at `-8`, the panel at `100` — the first three are furniture, the panel is summoned).

- **The first time**, it appears beside the selection: below it by default, flipped above when the bottom will not hold it, clamped into the viewport. With no selection, the upper third, centred.
- **After that it never moves on its own.** Two things change its position: you drag it, or the window shrinks below it (then it is pulled back into view — otherwise the header goes off-screen and can never be dragged back). Summoning brings it back, it does not re-place it. The position is **remembered across reloads**, so "the first time" means the first time ever.
- **Drag it by the header.** Pointer capture rather than window listeners, so the panel keeps up when the pointer outruns it and no text gets selected underneath the gesture. The buttons in that row are not a handle.
- **No backdrop.** A scrim would cover the very thing you are asking about. The layer is pass-through by construction; the panel turning `pointer-events` back on for itself is the whole of what it needs.
- **Clicking outside does not close it**, `Escape` does, and a successful send does **not** — the answer is about to arrive here.
- **The anchor follows the selection; the panel does not.** With it open, drag a new selection and the chip updates while the window stays put. A window that slid around while you typed would be a window you had to chase.
- **Dismissing does not clear the conversation.** Reopening returns you to it — which is what makes it a conversation. Starting over is New Chat's job, and it is a button precisely so that it is deliberate.

## The icon in the header

One icon in the session header's right-aligned utility row summons the panel. It sits in the same row as omdsh-sidepanel's switches, just inboard of them (`105` against their `110`); that row is a **list** slot, so this is purely additive: **omdsh-sidepanel is not modified and not imported**.

With no chord bound it is the only entry point. Its tooltip carries the current binding (`⌘L` on a Mac, `Ctrl+L` elsewhere), so someone who found the feature with the mouse can stop using the mouse for it.

The hard part is not the button, it is not destroying the selection while pressing it: a button press collapses the selection and moves focus before the click handler runs, which would leave every panel opened this way anchored to nothing. So `pointerdown` calls `preventDefault` — the same move a formatting toolbar makes.

### …and where it goes when that row is away

That row is not always on screen, and both states where it is missing are ordinary:

- **a blank conversation**, where the harness clears the entire header for the hero — so the very first thing you see would offer no way in;
- **Code mode**, where `omdsh-codemode` shadows the whole `conversation` seat with a terminal, header and all. The chord is yielded to the terminal there as well, so without a stand-in the panel would be unreachable for as long as Code mode was on.

So the same button has an **understudy** on the frame's floating layer, holding the corner the utility row occupies — the header's own measured padding, the row's own height — so the icon does not move when the header comes and goes. **The panel is there in Chat, Work and Code alike, with exactly one behavioural difference**: context embedding is switchable — off by default — in Chat and Work, and off with the button greyed in Code — that column is a terminal, there is no conversation to embed. The way in exists in all three.

The two never show at once, and what the understudy waits on is the header entry's own **mount report**, never a re-derivation of when the harness hides its header. That report is also the re-measure signal: the column keeps its exact geometry when Code mode takes it, so nothing about its box says the seat changed.

That corner is shared — omdsh-sidepanel's switches stand in there too, and omdsh-usage's badge tucks in from the other side — and the rule that packs them without a registry is: **measure only the occupant actually holding the corner (the rightmost right edge), and tuck inboard of it.** Taking the leftmost instead would measure surfaces that have themselves already tucked in, and since one of them measures this one, the two would chase each other outward for as long as either kept looking. A composition with an empty corner measures nothing and the icon simply takes it.

## That key

**This is the no-keybinding-layer case.** With `omdsh-shortcuts` composed, everything below stands down and the key is that plugin's — see [Binding a different key](#binding-a-different-key).

The harness publishes **no keybinding registry** (`ui-commands` is the contract for slash commands, not keys), so on its own this plugin installs its own window listener. The rules:

- **it takes ⌘L and nothing else** (plus Escape, and only while open);
- **it yields inside text**: an input, a textarea, a contenteditable, or any subtree flying `data-omdsh-sidechat-yield`. There the event is neither consumed nor `preventDefault`ed;
- **it consumes nothing while closed**;
- **inside its own panel it toggles**, or the yield rule would hand the key to the panel's own textarea.

**⌘L is also the browser's address-bar shortcut** — a deliberate trade, and the rules above are what pay for it. `Ctrl+L` is clear-screen in a terminal: a terminal that flies `data-omdsh-sidechat-yield` takes the key back whole.

## Binding a different key

**The answer for a person is [`omdsh-shortcuts`](https://github.com/omdsh-plugins/omdsh-shortcuts).** Install it beside this plugin and the summon becomes a row in its document like every other, rebindable from the settings panel with no code and no reload:

```sh
dsh plugin --profile web add @omdsh-plugins/omdsh-shortcuts
```

What that changes here is described below. The rest of this section is the plugin author's route — one service call, for a package that wants the chord for itself.

`CmdOrCtrl+L` is the default:

```ts
ctx.sidechat.setSummonChord('CmdOrCtrl+Shift+K')   // rebind
ctx.sidechat.summonChord()                          // → the current binding
ctx.sidechat.setSummonChord(null)                   // hand the key back
```

The syntax is **Electron's accelerator syntax** — what [`omdsh-shortcuts`](https://github.com/omdsh-plugins/omdsh-shortcuts)'s `MenuItem.accelerator` is written in, so a chord can later move onto a native menu item with no translation layer.

`null` hands the key back completely (a page handler racing a native menu for the same chord is the hardest class of bug to find); a rebinding takes effect immediately and releases the old chord in the same instant; a malformed accelerator throws rather than being ignored.

### With a keybinding layer installed

A composition that has one should have exactly **one** place where keys are decided, and two listeners racing for one chord is the failure that place exists to prevent. So when the `shortcut` service is there — [`omdsh-shortcuts`](https://github.com/omdsh-plugins/omdsh-shortcuts) publishes it — this plugin gives the key up (`setSummonChord(null)`, after which its own listener consumes nothing at all) and registers the summon as the command **`sidechat.open`** instead. The chord becomes a row in that plugin's document like every other, and the tooltip keeps teaching it: the binding is read back out of the switchboard on every revision, so a rebinding in the settings panel reaches the icon with no reload.

Until a chord is bound to `sidechat.open` there, the header icon is the way in — which is the honest state, not a broken one: the built-in ⌘L is gone precisely because the keys are somebody else's to decide now.

**Without that plugin nothing here changes.** The handover runs on a restricted fiber started inside `apply`, never from a top-level `inject`: whether another plugin's service exists is a property of the profile, and a loader entry waiting on one nobody composed sits `pending` forever — which fails the boot audit and takes the whole page down, not just this feature. So a profile with no keybinding layer keeps the built-in ⌘L, and unloading one at runtime hands the chord straight back rather than leaving the panel with no key at all.

## No host half

`src/index.ts` is an empty `apply()`.

The panel asks through `ISession.prompt`, reads answers through `SessionFace` (which *is* an `ObservableSnapshot<ConversationSnapshot>`), and finds a home through `ISessions.fork` or the runtime's own `session.create` — with the hide and the save going through `IWorkspaces.archiveSession` and one more fork — all public faces the browser already holds. The mode comes from the `sessionModes` service `omdsh-basemode` publishes, reached by name on a restricted fiber and treated as "no mode system" when it is not there. The anchor is built from the browser's own selection, with no filesystem read. So **there is no route to serve, no working directory to fence, and no reach for this plugin to acquire**.

The empty `apply()` exists to make this package a Loader entry, because that is the set `dsh-client-modules` scans for `dsh.client`.

Runtime dependencies: **none**. Everything it draws with is a face the harness already published.

## Install

```sh
npx @omdsh-plugins/omdsh-plughub add omdsh-sidechat
```

That is the [plugin hub](https://github.com/omdsh-plugins/omdsh-plughub)'s
installer with argv where the button was. It resolves this plugin from the
collection's [registry](https://github.com/omdsh-plugins/registry), installs it
from its GitHub repository, and writes the pnpm build-allowlist entry a bare
`dsh plugin add github:…` would leave to you — the entry carries the commit pnpm
resolved, so it can be copied out of a failure and never written down in
advance.

`dsh plugin --profile web add @omdsh-plugins/omdsh-sidechat` is **not** that command yet:
this package is not on npm, and pnpm answers `ERR_PNPM_FETCH_404`. The same
install is also a button, on this plugin's card in **Settings → Plugins → Plugin
hub**, once the hub itself is in the profile.

Or from a checkout:

```sh
pnpm install && pnpm run build
dsh plugin --profile web add "$PWD"
dsh web --port <n>
```

Remove it the same way:

```sh
dsh plugin --profile web remove @omdsh-plugins/omdsh-sidechat
```

It needs a **web surface**: the browser half is everything here, and its `inject` names only harness services (`slots`, `sessions`, `workspaces`, `locale`). On a surface with no browser — the TUI, headless — the client half is never fetched and the node half is a no-op, which is correct: there is nothing here to run.

Every companion is optional and each absence is answered rather than fatal. With no `omdsh-chatmode` there is no `Chat` workspace, so a standalone side conversation opens in the current conversation's workspace instead; with no `omdsh-basemode` there is no mode system, so embedding is treated as Chat/Work (always embeddable, off by default, button enabled); with no `omdsh-shortcuts` the built-in ⌘L stays; with no `omdsh-sidepanel` the header corner is simply emptier. None of them appears in a top-level `inject`, so a profile missing them all boots and this plugin works.

**It registers no settings namespace.** There is nothing here a form could draw — the one adjustable thing is the chord, and that is either the built-in default or a row in `omdsh-shortcuts`'s document — so the plugin hub lists this package and offers no controls, which is the honest rendering rather than an empty panel.

## Commands

```sh
pnpm install
pnpm run harness:local ../../deepseek-harness   # build that checkout first
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run check:harness-pin                      # fails while anything is linked
pnpm run harness:npm                            # back to the registry pin before committing
```

A `link:` path is an **argument, never a committed value** — it resolves against the manifest that declares it, so writing one down bakes a single machine's layout into the package, and it fails silently. `pnpm run check:harness-pin` catches that.

The specs are deliberately kept runnable under the registry pin: every harness import in the pure-logic modules is `import type`, so a bare clone can `pnpm install && pnpm test`. `transcript.ts` takes the content classifier as a **parameter** rather than importing it for exactly that reason — that display rule is the thing in this package most worth checking. The embed decision is a pure function the same way (`embed.ts`), with specs of its own.

## Known limitations

- **It never touches the conversation you are running.** A fork only reads the source's history; a question is never sent into the main session from here. And the reverse holds too: there is no way to send a question into the main session, only to cut a branch of its own.
- **Embedding is a snapshot of the moment the branch was cut.** Once forked, nothing the source says afterwards flows in; to catch up, press the embed button again and cut a new branch.
- **Saving is a fork too.** The harness has no "unhide" verb, so Save cuts a branch of the hidden conversation and the panel continues there; the hidden original — including everything said after the save — is not in the sidebar, and there is no way to delete it from this panel.
- **Unsaved conversations are invisible, not gone.** They are real persisted sessions the sidebar agrees not to draw; New Chat leaves the old one behind with no sidebar row to reopen it from, and only this panel's localStorage record still reaches it.
- **No reasoning and no tool calls.** They are dropped rather than collapsed. When you want them, the button in the header takes you to the workbench where they are all laid out.
- **It reads no files.** The anchor is whatever the DOM already showed you; there is no `@` completion of its own, and no way to attach a file the page was not displaying.
- **One anchor, one file.** A quotation spanning two files is two questions, and images are not accepted at all — that is a composer capability, and this is not a composer.
- **The chord cannot be changed from a settings panel on its own.** Rebinding it means either installing `omdsh-shortcuts` or calling `setSummonChord` from another plugin; this package registers no settings namespace of its own.
- **One panel per frame.** It is a single overlay entry with one remembered position and one remembered conversation, so there is no second side chat to put beside the first.
