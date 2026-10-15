// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// String-valued because the choice persists to `sessionStorage`.
export enum HotOpsSort {
    DURATION = 'duration',
    OPERATION_ID = 'operationId',
}

export const HOT_OPS_LIMITS = [10, 25, 100] as const;

/** Shown where a rank would be, for an op without perf data. */
export const HOT_OPS_NO_RANK_LABEL = '–';

/** Rows to show, or `null` for all of them. */
export type HotOpsLimit = (typeof HOT_OPS_LIMITS)[number] | null;

export interface HotOpsSettings {
    limit: HotOpsLimit;
    sort: HotOpsSort;
    hideUnlinked: boolean;
    /** Badge the ops the list shows on the graph. #2085 */
    markOnGraph: boolean;
}

/** Which ops the graph badges: the list's own, whatever order it puts them in. */
export type HotOpsMarking = Pick<HotOpsSettings, 'limit' | 'hideUnlinked'>;

export const DEFAULT_HOT_OPS_SETTINGS: HotOpsSettings = {
    limit: HOT_OPS_LIMITS[0],
    sort: HotOpsSort.DURATION,
    hideUnlinked: true,
    markOnGraph: false,
};

export const HOT_OPS_ENABLED_STORAGE_KEY = 'opGraphHotOpsEnabled';
export const HOT_OPS_SETTINGS_STORAGE_KEY = 'opGraphHotOpsSettings';
