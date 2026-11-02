// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getDeviceRowOpIds } from '../src/functions/deviceRowOpIds';
import { PerfTableRow } from '../src/model/PerfTable';

const mergedRow = (id: number, deviceRowIds?: number[]) =>
    ({ id: String(id), ...(deviceRowIds ? { device_row_ids: deviceRowIds } : {}) }) as PerfTableRow;

describe('getDeviceRowOpIds', () => {
    it('carries a linked merged row’s op onto every other per-device row it stands for', () => {
        const rows = [mergedRow(4, [2, 4, 7]), mergedRow(5, [3, 5, 6])];

        expect(Object.fromEntries(getDeviceRowOpIds(rows, new Map([['4', 10]])))).toEqual({ '2': 10, '7': 10 });
    });

    it('adds nothing for a merged row that is not linked, or that names no members', () => {
        const rows = [mergedRow(4, [2, 4]), mergedRow(5)];

        expect(getDeviceRowOpIds(rows, new Map([['5', 11]])).size).toBe(0);
    });

    it('never overrides a row that is already linked', () => {
        const rows = [mergedRow(4, [2, 4])];
        const opIdByPerfId = new Map([
            ['4', 10],
            ['2', 99],
        ]);

        expect(getDeviceRowOpIds(rows, opIdByPerfId).size).toBe(0);
    });
});
