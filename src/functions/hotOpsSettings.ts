// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    DEFAULT_HOT_OPS_SETTINGS,
    HOT_OPS_LIMITS,
    type HotOpsLimit,
    type HotOpsSettings,
    HotOpsSort,
} from '../definitions/HotOps';

export const isHotOpsLimit = (value: unknown): value is HotOpsLimit =>
    value === null || HOT_OPS_LIMITS.some((limit) => limit === value);

export const isHotOpsSort = (value: unknown): value is HotOpsSort =>
    Object.values(HotOpsSort).some((sort) => sort === value);

/** Stored settings read field by field, so a shape from another build falls back to the defaults. */
export const parseHotOpsSettings = (stored: unknown): HotOpsSettings => {
    const fields: Record<string, unknown> = typeof stored === 'object' && stored !== null ? { ...stored } : {};
    return {
        limit: isHotOpsLimit(fields.limit) ? fields.limit : DEFAULT_HOT_OPS_SETTINGS.limit,
        sort: isHotOpsSort(fields.sort) ? fields.sort : DEFAULT_HOT_OPS_SETTINGS.sort,
        hideUnlinked:
            typeof fields.hideUnlinked === 'boolean' ? fields.hideUnlinked : DEFAULT_HOT_OPS_SETTINGS.hideUnlinked,
    };
};

export const parseHotOpsEnabled = (stored: unknown): boolean => stored === true;
