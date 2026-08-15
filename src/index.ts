/**
 * Side chat, host half: nothing.
 *
 * That is not an omission, it is the design. The input this plugin summons
 * asks its question through `ISession.prompt`, which the browser already
 * holds, and it builds its anchor out of the browser's own selection. Neither
 * needs a byte from the filesystem, so there is no route to serve, no working
 * directory to fence, and no reach for this plugin to acquire that the person
 * driving the browser did not already have.
 *
 * What remains is registration. `dsh-client-modules` discovers browser halves
 * by scanning the host Loader's ENTRIES for a `dsh.client` declaration, so a
 * package with no node behaviour still has to be a loadable cordis plugin to
 * be seen at all. This module is that, and only that.
 *
 * Compare `omdsh-sidepanel`, whose panels genuinely cannot exist without a host
 * half: no harness API reads a file, and `ctx.terminals` is fenced to a live
 * Agent. Reading a file is a capability; reading a selection is not.
 * @module @omdsh-plugins/omdsh-sidechat
 */

export {
  ANCHOR_LINE_ATTR, ANCHOR_PATH_ATTR, SIDECHAT_ROOT_ATTR, SIDECHAT_YIELD_ATTR,
} from './conventions.ts'

/** Cordis plugin name. */
export const name = 'omdsh-sidechat'

/**
 * Mount the host half.
 *
 * Empty by contract. Should this package ever need a node side, that is the
 * moment to ask what capability it just acquired and what fences it now owes
 * — the emptiness here is the thing worth defending.
 */
export function apply(): void {}
