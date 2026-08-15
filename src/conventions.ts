/**
 * Everything this plugin asks of the rest of the app, in four attribute names.
 *
 * All four are ATTRIBUTE contracts rather than APIs. A panel that wants its
 * rows anchorable, or wants the summon key left alone, adds an attribute and
 * stops — it imports nothing from this package, gains no dependency on it, and
 * behaves identically when this plugin is not installed. That is the shape
 * `omdsh-sidepanel` already uses when it reaches for `#root` and
 * `[data-slot="conversation"]`: a published anchor, not a class name and not a
 * DOM shape, where absence is a skip rather than an error.
 *
 * None of them is required. With none present the input still summons and
 * still delivers — it simply carries no location, which is the honest outcome
 * when nothing under the pointer ever said where it lived.
 * @module @omdsh-plugins/omdsh-sidechat/src/conventions
 */

/**
 * Path of the file or directory a subtree is showing, as the workspace sees
 * it. Absolute, or relative to the conversation's working directory — the
 * composer resolves it against `cwd` either way, and writes the relative form
 * into the prompt because that is the form the agent can act on.
 *
 * Read from the NEAREST ancestor of the selection, so a panel may put it once
 * on its preview container and let every line inherit it.
 */
export const ANCHOR_PATH_ATTR = 'data-omdsh-anchor'

/**
 * 1-based line number of the row that carries it. Read from the nearest
 * ancestor of each selection END, so a selection spanning rows yields a range
 * and a selection inside one row yields a single line.
 *
 * Absent on a surface with no line structure (a rendered document, a message
 * body); the anchor then carries a path and no range, which is correct.
 */
export const ANCHOR_LINE_ATTR = 'data-omdsh-anchor-line'

/**
 * Put on a subtree that owns the summon key itself. Inside it the shortcut is
 * never taken and never even prevented — the surface's own binding runs as
 * though this plugin were not installed.
 *
 * This exists because a terminal is not a text field but has every right to
 * Ctrl+L — that is clear-screen, and it has been for as long as there have
 * been terminals — and because guessing which surfaces those are is exactly
 * the kind of knowledge this package should not accumulate. A surface that
 * wants the key says so.
 */
export const SIDECHAT_YIELD_ATTR = 'data-omdsh-sidechat-yield'

/**
 * Marks this plugin's own overlay. Two readings depend on it: a selection
 * inside the draft is the person re-reading what they typed rather than a
 * quotation of anything, and the summon key pressed inside the box toggles it
 * shut instead of yielding to the textarea under the cursor.
 */
export const SIDECHAT_ROOT_ATTR = 'data-omdsh-sidechat'
