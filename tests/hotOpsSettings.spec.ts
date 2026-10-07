// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { DEFAULT_HOT_OPS_SETTINGS, HotOpsSort } from '../src/definitions/HotOps';
import { parseHotOpsEnabled, parseHotOpsSettings } from '../src/functions/hotOpsSettings';

describe('parseHotOpsSettings', () => {
    it('keeps a stored shape it recognises', () => {
        const stored = { limit: 25, sort: HotOpsSort.OPERATION_ID, hideUnlinked: false };

        expect(parseHotOpsSettings(stored)).toEqual(stored);
    });

    it('keeps "All", which is stored as no limit', () => {
        expect(parseHotOpsSettings({ ...DEFAULT_HOT_OPS_SETTINGS, limit: null }).limit).toBeNull();
    });

    it('falls back field by field, so one bad field does not cost the rest', () => {
        expect(parseHotOpsSettings({ limit: 7, sort: 'bogus', hideUnlinked: false })).toEqual({
            ...DEFAULT_HOT_OPS_SETTINGS,
            hideUnlinked: false,
        });
    });

    it('fills in fields a shape from another build does not have', () => {
        expect(parseHotOpsSettings({ limit: 100 })).toEqual({ ...DEFAULT_HOT_OPS_SETTINGS, limit: 100 });
    });

    it.each([null, undefined, 'top10', 10, []])('reads %j as the defaults', (stored) => {
        expect(parseHotOpsSettings(stored)).toEqual(DEFAULT_HOT_OPS_SETTINGS);
    });
});

describe('parseHotOpsEnabled', () => {
    it('is on only for a stored true', () => {
        expect(parseHotOpsEnabled(true)).toBe(true);
        expect(parseHotOpsEnabled(false)).toBe(false);
    });

    it.each([null, 'true', 1, {}])('reads %j as off', (stored) => {
        expect(parseHotOpsEnabled(stored)).toBe(false);
    });
});
