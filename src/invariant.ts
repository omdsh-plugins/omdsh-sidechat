/**
 * Package-owned invariant companion for `@omdsh-plugins/omdsh-sidechat`.
 * @module @omdsh-plugins/omdsh-sidechat/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@omdsh-plugins/omdsh-sidechat'

/** Cordis companion plugin name. */
export const name = 'omdsh-sidechat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant. This package owns exactly one piece of state — an
 * overlay that is either open or not, over an anchor recomputed from the live
 * DOM on every read — and it emits no cordis event. The one cross-plugin fact
 * it publishes is the anchor-source roster, whose only rule (a registration is
 * removed by its own disposer) is the cordis effect contract rather than
 * something an invariant could add to. Everything else is asserted directly by
 * this package's specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
