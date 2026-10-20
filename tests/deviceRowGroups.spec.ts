// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getSiblingOpIds, groupDeviceRowsLikeMerge } from '../src/functions/deviceRowGroups';
import { OpType } from '../src/definitions/Performance';
import { PerfTableRow } from '../src/model/PerfTable';
import { makeRawPerfRow } from './helpers/perfRowFixtures';
// The smoke fixture's rows as the backend serves them, merged and unmerged, with the
// linked filters (host ops hidden, no signposts, tracing off). Regenerate by running
// `OpsPerformanceReportQueries.generate_report` on
// `scripts/fixtures/smoke-performance-report` with `merge_devices` True and False,
// keeping these fields, whenever the pinned tt-perf-report version moves.
import smokeDeviceRows from './data/smokePerfReportDeviceRows.json';

const row = (id: number, device: number, rawOpCode: string, overrides: Partial<PerfTableRow> = {}) =>
    makeRawPerfRow({ id: String(id), device: String(device), raw_op_code: rawOpCode, ...overrides });

const ids = (groups: PerfTableRow[][]) => groups.map((group) => group.map(({ id }) => id));

describe('groupDeviceRowsLikeMerge', () => {
    it('pairs the k-th op of each device', () => {
        const rows = [row(2, 0, 'Matmul'), row(3, 1, 'Matmul'), row(4, 0, 'Softmax'), row(5, 1, 'Softmax')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([
            ['2', '3'],
            ['4', '5'],
        ]);
    });

    it('groups by position, so repeated op names pair in order', () => {
        const rows = [row(2, 0, 'Matmul'), row(3, 0, 'Matmul'), row(4, 1, 'Matmul'), row(5, 1, 'Matmul')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([
            ['2', '4'],
            ['3', '5'],
        ]);
    });

    it('takes devices in ascending order, whichever reaches the row first', () => {
        const rows = [row(2, 1, 'AllGather'), row(3, 0, 'AllGather')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['3', '2']]);
    });

    it('holds back a device whose next op differs, retrying it next round', () => {
        // Device 1 never ran the first Softmax, so its Matmul waits for device 0's.
        const rows = [row(2, 0, 'Softmax'), row(3, 0, 'Matmul'), row(4, 1, 'Matmul')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['2'], ['3', '4']]);
    });

    it('leaves host ops, signposts and rows with no device out of every group', () => {
        const rows = [
            row(2, 0, 'Matmul'),
            row(3, 0, 'HostOp', { op_type: OpType.PYTHON_OP }),
            row(4, 0, 'BEGIN', { op_type: OpType.SIGNPOST }),
            row(5, 0, 'Matmul', { device: '' }),
            row(6, 1, 'Matmul'),
        ];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['2', '6']]);
    });
});

describe('getSiblingOpIds', () => {
    it('carries the linked member’s op onto the rest of its group', () => {
        const groups = [[row(2, 0, 'Matmul'), row(3, 1, 'Matmul')]];

        expect(getSiblingOpIds(groups, new Map([['3', 7]]))).toEqual(new Map([['2', 7]]));
    });

    it('leaves a group with no linked member unlinked', () => {
        const groups = [[row(2, 0, 'Matmul'), row(3, 1, 'Matmul')]];

        expect(getSiblingOpIds(groups, new Map())).toEqual(new Map());
    });

    it('leaves a group with two linked members unlinked rather than guess between them', () => {
        const groups = [[row(2, 0, 'Matmul'), row(3, 1, 'Matmul'), row(4, 2, 'Matmul')]];

        expect(
            getSiblingOpIds(
                groups,
                new Map([
                    ['2', 7],
                    ['3', 8],
                ]),
            ),
        ).toEqual(new Map());
    });
});

describe('parity with tt-perf-report on the smoke fixture', () => {
    const merged = smokeDeviceRows.merged as unknown as PerfTableRow[];
    const unmerged = smokeDeviceRows.unmerged as unknown as PerfTableRow[];
    const groups = groupDeviceRowsLikeMerge(unmerged);
    const mergedIds = new Set(merged.map(({ id }) => id));

    it('forms one group per merged row', () => {
        expect(groups).toHaveLength(merged.length);
    });

    it('puts exactly one merged row in every group', () => {
        for (const group of groups) {
            expect(group.filter(({ id }) => mergedIds.has(id))).toHaveLength(1);
        }
    });

    it('links every unmerged row once each merged row is linked', () => {
        const opIdByPerfId = new Map(merged.map(({ id }, index) => [id, index]));
        const siblingOpIds = getSiblingOpIds(groups, opIdByPerfId);

        expect(siblingOpIds.size + opIdByPerfId.size).toBe(unmerged.length);
    });
});
