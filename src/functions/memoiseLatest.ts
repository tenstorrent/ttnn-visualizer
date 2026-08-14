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
 */
const memoiseLatest = <TArgs extends unknown[], TResult>(compute: (...args: TArgs) => TResult) => {
    let lastArgs: TArgs | null = null;
    let lastResult: TResult;

    return (...args: TArgs): TResult => {
        if (lastArgs !== null && lastArgs.length === args.length && lastArgs.every((arg, i) => arg === args[i])) {
            return lastResult;
        }

        lastArgs = args;
        lastResult = compute(...args);

        return lastResult;
    };
};

export default memoiseLatest;
