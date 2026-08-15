# omdsh-sidechat

[简体中文](README.zh.md)

Press ⌘L **anywhere** in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI to open a **conversation of its own**, right where you are. It carries whatever you were looking at as its anchor, and both the question and the answer stay in its own session — the one you are actually running is not touched, context included.

## What it is

The harness has one input, at the bottom of the conversation column, and it belongs to the thing you are running. So every "wait, what does this function do?" costs you twice: your hands leave what you were reading, and **the question moves into that conversation's context**, where it stays — taking up window, shaping every turn after it.

This plugin deletes both costs: **summon a conversation of your own, where you already are.**

It is a full session — multi-turn, with history, stored in the `Chat` workspace, no different from any conversation you open from the sidebar. It just happens to be summoned from beside the line you were pointing at.

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

In **a session of its own**, in the host-managed `Chat` workspace — the one [`omdsh-justchat`](https://github.com/omdsh-plugins/omdsh-justchat) creates and [`omdsh-sidepanel`](https://github.com/omdsh-plugins/omdsh-sidepanel) derives its mode from, matched here by the **title** a user reads rather than by an import. That is a product fact (it is the group heading in the sidebar), which is how three packages agree on it without depending on each other.

A deployment without the chat plugin has no such workspace; there it opens a second session in **the current conversation's workspace** instead. The two contexts stay apart either way — they just share a directory. This plugin does not quietly become a dependent of that one.

**Remembered across reloads**: the side conversation in use is kept in localStorage. A remembered id is verified against the session list first — a conversation that was deleted is not an error, it is a conversation that ended.

And **what was said in it comes back too**. The harness pulls a session's history for the session that is on stage, and this one deliberately never is — so the panel asks for its own window when it binds (`transcript-source.ts`). Without that step a remembered conversation returns live but blank: everything said after the reload, nothing said before it.

## The three buttons in the header

**Open in the Chat window** — jump to this conversation in the main UI. It is an ordinary session in the `Chat` workspace already, so "opening" it is just navigation (`sessions.open`): no export, no copy, no second representation of the same messages. Go there to keep talking at length, or to see the full reasoning and tool calls — that is the workbench, this is the side. Disabled until a conversation is connected.

**New chat** — below.

**Close** — dismisses the panel only; the conversation is untouched.

## New chat

The button in the panel header. It starts a fresh one; the previous conversation stays in the `Chat` workspace and can be reopened from the sidebar like any other.

Underneath it is `connectWorkspace`, which **reuses the workspace's blank session** — so pressing it twice without saying anything leaves you in the same empty conversation rather than littering `Chat` with shells. Same rule the harness's own New Session follows.

## Where the anchor comes from

An anchor is a fact about a location: a path, a line range, the text you had selected. Each part can be absent on its own.

Registered anchor sources are asked first, newest first. When none answers, the built-in reading takes over — **the browser's own selection**:

- the selected text is the quotation;
- the nearest `data-omdsh-anchor` above the selection is the path;
- the nearest `data-omdsh-anchor-line` above each end gives the lines.

Both attributes are optional and each absence is one step down. With none of them the anchor is empty — the panel still summons and still asks, it simply carries no location.

Those attributes are a **published convention**, the same shape `omdsh-sidepanel` uses when it reaches for `#root` and `[data-slot="conversation"]`: **a published anchor, not a class name and not a DOM shape**, where absence is a skip rather than an error. Making your own panel anchorable costs one attribute.

A panel that knows more than the DOM can express can say so directly:

```ts
ctx.sidechat.registerAnchorSource(() => ({ origin: 'element', path: currentFile }))
```

## What it sends

Exactly **one thing crosses** between the two conversations: the anchor, as text. `PromptContentPart` is `text` or `image`, so an anchor cannot travel as structure — it travels as the shape a person would have typed:

````
/w/proj/src/client/apply.ts:199-205

```ts
      children: {
        'conversation.view': { kind: 'list', scope: 'session' },
```

Why is this slot's scope session?
````

**Note that it is absolute.** Two working directories are in play and they are usually not the same one: the anchor comes from the workspace you are looking at, the side conversation lives in `Chat`. So the path is rooted against **where it came from** and only then made relative to **where it is going** — relative when both are the same directory, absolute when they are not, neither case special-cased. An absolute path the receiver cannot shorten is the **correct** answer, not a degraded one: it is the only form that still names the right file.

**A quotation is clamped, never streamed.** Past 60 lines the middle goes, past 4096 bytes the tail goes, both say how much was dropped, and both say it **in the panel before you press Enter**.

The clamp markers are English regardless of interface language: they are read by the agent, not by the person.

A draft that is a single line starting with `/` **and carries no anchor** goes to `session.command()`; an unmatched line is sent on as text. A draft WITH an anchor never takes the command path — a command takes one line and nothing else, and silently dropping what you pointed at is the one outcome this surface must never produce.

## Queue or steer

| Side conversation | Enter | ⌘⏎ |
|---|---|---|
| idle | sends | sends |
| answering | `queue` (after the current turn) | `steer` (into the current turn) |

Note that this column is about whether **the side conversation** is busy. Your main session being busy is precisely the situation this plugin exists for; it never reads as "the side chat is busy".

A failed send **keeps the error code**. The question itself is already in the transcript, which is a better acknowledgement than any banner and one that is still readable a minute later.

## Where it sits

`shell.overlay`, ui-layout's frame-wide floating layer. A **list** slot, so standing here costs nobody their seat: `omdsh-sidepanel`'s panels are already there and everyone orders among themselves (panels at `-10`, omdsh-sidepanel's understudy at `-9`, [this plugin's own icon understudy](#and-where-it-goes-when-that-row-is-away) at `-8`, the panel at `100` — the first three are furniture, the panel is summoned).

- **The first time**, it appears beside the selection: below it by default, flipped above when the bottom will not hold it, clamped into the viewport. With no selection, the upper third, centred.
- **After that it never moves on its own.** Two things change its position: you drag it, or the window shrinks below it (then it is pulled back into view — otherwise the header goes off-screen and can never be dragged back). Summoning brings it back, it does not re-place it. The position is **remembered across reloads**, so "the first time" means the first time ever.
- **Drag it by the header.** Pointer capture rather than window listeners, so the panel keeps up when the pointer outruns it and no text gets selected underneath the gesture. The buttons in that row are not a handle.
- **No backdrop.** A scrim would cover the very thing you are asking about.
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
- **Code mode**, where `omdsh-code` shadows the whole `conversation` seat with a terminal, header and all. The chord is yielded to the terminal there as well, so without a stand-in the panel would be unreachable for as long as Code mode was on.

So the same button has an **understudy** on the frame's floating layer, holding the corner the utility row occupies — the header's own measured padding, the row's own height — so the icon does not move when the header comes and goes. **The panel works identically in Chat, Work and Code, so its way in exists in all three.**

The two never show at once, and what the understudy waits on is the header entry's own **mount report**, never a re-derivation of when the harness hides its header. That report is also the re-measure signal: the column keeps its exact geometry when Code mode takes it, so nothing about its box says the seat changed.

That corner is shared — omdsh-sidepanel's switches stand in there too, and omdsh-usage's badge tucks in from the other side — and the rule that packs them without a registry is: **measure only the occupant actually holding the corner (the rightmost right edge), and tuck inboard of it.** Taking the leftmost instead would measure surfaces that have themselves already tucked in, and since one of them measures this one, the two would chase each other outward for as long as either kept looking. A composition with an empty corner measures nothing and the icon simply takes it.

## That key

The harness publishes **no keybinding registry** (`ui-commands` is the contract for slash commands, not keys), so this plugin installs its own window listener. The rules:

- **it takes ⌘L and nothing else** (plus Escape, and only while open);
- **it yields inside text**: an input, a textarea, a contenteditable, or any subtree flying `data-omdsh-sidechat-yield`. There the event is neither consumed nor prevented;
- **it consumes nothing while closed**;
- **inside its own panel it toggles**, or the yield rule would hand the key to the panel's own textarea.

**⌘L is also the browser's address-bar shortcut** — a deliberate trade, and the rules above are what pay for it. `Ctrl+L` is clear-screen in a terminal, which is what the yield attribute is for.

## Binding a different key

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

**Without that plugin nothing here changes.** The handover runs on a restricted fiber started inside `apply`, never from a top-level `inject`: whether another plugin's service exists is a property of the profile, and a loader entry waiting on one nobody composed sits `pending` forever — which fails the boot audit and takes the whole page down, not just this feature. So a profile with no keybinding layer keeps the built-in ⌘L, and unloading one at runtime hands the chord straight back rather than leaving the panel with no key at all.

## No host half

`src/index.ts` is an empty `apply()`.

The panel asks through `ISession.prompt`, reads answers through `SessionFace` (which *is* an `ObservableSnapshot<ConversationSnapshot>`), and finds a home through `IWorkspaces.connectWorkspace` — all public faces the browser already holds. The anchor is built from the browser's own selection, with no filesystem read. So **there is no route to serve, no working directory to fence, and no reach for this plugin to acquire**.

The empty `apply()` exists to make this package a Loader entry, because that is the set `dsh-client-modules` scans for `dsh.client`.

## What it does not do

Touch the conversation you are running (the whole plugin stands on this), show reasoning or tool calls, read files, build its own `@` completion, carry more than one anchor, or accept images (that is a composer capability).

Runtime dependencies: **none**.

## Development

```sh
pnpm install
pnpm run harness:local ../../deepseek-harness   # build that checkout first
pnpm run build
pnpm run test
pnpm run harness:npm                            # back to the registry pin before committing
```

A `link:` path is an **argument, never a committed value** — it resolves against the manifest that declares it, so writing one down bakes a single machine's layout into the package, and it fails silently. `pnpm run check:harness-pin` catches that.

The specs are deliberately kept runnable under the registry pin: every harness import in the pure-logic modules is `import type`, so a bare clone can `pnpm install && pnpm test`. `transcript.ts` takes the content classifier as a **parameter** rather than importing it for exactly that reason — that display rule is the thing in this package most worth checking.

End to end:

```sh
dsh plugin --profile web add <path>
dsh web --port <n>
```
