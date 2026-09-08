// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Append `value` if absent, otherwise remove it — the multi-select / chart-amend toggle.
 *
 * Primitives only, deliberately: membership is `includes`/`!==`, so a caller toggling object
 * identities (PerfChartFilter's `Marker`) needs a value-equality variant rather than this.
 */
export function toggleListMembership<T extends string | number>(list: readonly T[], value: T): T[] {
    if (list.includes(value)) {
        return list.filter((item) => item !== value);
    }

    return [...list, value];
}
