// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * @description Cache-of-one memoisation keyed on reference-equal arguments.
 *
 * `useMemo` caches per hook invocation, so a derived value read by many call
 * sites is recomputed once per caller even though every caller sees the same
 * query data. Routing the computation through a module-level cache collapses
 * that to one, provided the inputs come from a shared source with a stable
 * identity (a React Query result, say) rather than from a per-caller `useMemo`.
 *
 * A cache of one never serves a stale result: arguments that differ by reference
 * always recompute. Callers must treat the result as immutable, since they now
 * share it.
 *
 * A cache of one also degrades to no cache at all: two live consumers passing
 * different arguments in the same render pass each recompute and each receive a
 * fresh identity, defeating any downstream `useMemo` keyed on the result. Every
 * argument must come from a source all consumers share.
 */
const memoiseLatest = <TArgs extends unknown[], TResult>(compute: (...args: TArgs) => TResult) => {
    // Arguments and result live or die together in one record, so a reset cannot
    // release the arguments while leaving the result reachable.
    let cache: { args: TArgs; result: TResult } | null = null;

    const memoised = (...args: TArgs): TResult => {
        if (cache !== null && cache.args.length === args.length && cache.args.every((arg, i) => arg === args[i])) {
            return cache.result;
        }

        // Written only once `compute` has returned. Recording the arguments first
        // would pair them with the *previous* result if `compute` threw, and every
        // later call with those same arguments would then be served that
        // mismatched result from cache — permanently, and silently.
        const result = compute(...args);

        cache = { args, result };

        return result;
    };

    // The cache outlives the query data it derives from, so whoever discards that
    // data has to say so — otherwise the previous report's rows stay reachable
    // from module state for the lifetime of the page.
    memoised.reset = () => {
        cache = null;
    };

    return memoised;
};

export default memoiseLatest;
