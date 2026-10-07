// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// String-valued because the choice persists to `sessionStorage`.
export enum HotOpsSort {
    DURATION = 'duration',
    OPERATION_ID = 'operationId',
}

export const HOT_OPS_LIMITS = [10, 25, 100] as const;

export interface HotOpsPanelState {
    isShown: boolean;
    /** Rows to show, or `null` for all of them. */
    limit: number | null;
    sort: HotOpsSort;
    hideUnlinked: boolean;
}

export const DEFAULT_HOT_OPS_PANEL_STATE: HotOpsPanelState = {
    isShown: false,
    limit: HOT_OPS_LIMITS[0],
    sort: HotOpsSort.DURATION,
    hideUnlinked: true,
};
