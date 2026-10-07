// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// String-valued because the choice persists to `sessionStorage`.
export enum HotOpsSort {
    DURATION = 'duration',
    OPERATION_ID = 'operationId',
}

export const HOT_OPS_LIMITS = [10, 25, 100] as const;

/** Rows to show, or `null` for all of them. */
export type HotOpsLimit = (typeof HOT_OPS_LIMITS)[number] | null;

export interface HotOpsSettings {
    limit: HotOpsLimit;
    sort: HotOpsSort;
    hideUnlinked: boolean;
}

export const DEFAULT_HOT_OPS_SETTINGS: HotOpsSettings = {
    limit: HOT_OPS_LIMITS[0],
    sort: HotOpsSort.DURATION,
    hideUnlinked: true,
};

export const HOT_OPS_ENABLED_STORAGE_KEY = 'opGraphHotOpsEnabled';
export const HOT_OPS_SETTINGS_STORAGE_KEY = 'opGraphHotOpsSettings';
