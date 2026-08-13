// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** Append `value` if absent, otherwise remove it — the MultiSelectField / chart-amend toggle. */
export function toggleListMembership<T>(list: readonly T[], value: T): T[] {
    if (list.includes(value)) {
        return list.filter((item) => item !== value);
    }

    return [...list, value];
}
