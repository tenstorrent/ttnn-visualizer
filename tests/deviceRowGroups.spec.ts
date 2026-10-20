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
// `test_frontend_device_rows_fixture_matches_the_report` fails when it drifts.
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

    // The expected groups in this block were checked against `merge_device_rows` in the
    // pinned tt-perf-report, run on the same rows: it kept the ids each case names.

    it('takes devices in ascending numeric order, whichever reaches the row first', () => {
        // Sorted as text, device 10 would lead. The merge keeps device 2's row (id 3) for a
        // collective, which only holds if device 2 heads the group.
        const rows = [row(2, 10, 'AllGather'), row(3, 2, 'AllGather')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['3', '2']]);
    });

    it('holds back a device whose next op differs, retrying it next round', () => {
        // Device 1 never ran the first Softmax, so its Matmul waits for device 0's. The merge
        // keeps ids 2 and 4, one per group.
        const rows = [row(2, 0, 'Softmax'), row(3, 0, 'Matmul'), row(4, 1, 'Matmul')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['2'], ['3', '4']]);
    });

    it('leaves the longer device’s trailing rows in groups of their own', () => {
        // The merge keeps ids 3, 5 and 6: id 6 has no partner on device 1.
        const rows = [row(2, 0, 'A'), row(3, 1, 'A'), row(4, 0, 'B'), row(5, 1, 'B'), row(6, 0, 'C')];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['2', '3'], ['4', '5'], ['6']]);
    });

    it('returns no groups for no rows', () => {
        expect(groupDeviceRowsLikeMerge([])).toEqual([]);
    });

    it('leaves host ops, signposts and rows with no device out of every group', () => {
        const rows = [
            row(2, 0, 'Matmul'),
            row(3, 0, 'HostOp', { op_type: OpType.PYTHON_OP }),
            row(4, 0, 'BEGIN', { op_type: OpType.SIGNPOST }),
            row(5, 0, 'Matmul', { device: '' }),
            row(6, 0, 'Matmul', { device: 'N/A' }),
            row(7, 1, 'Matmul'),
        ];

        expect(ids(groupDeviceRowsLikeMerge(rows))).toEqual([['2', '7']]);
    });
});

describe('getSiblingOpIds', () => {
    it('carries the linked member’s op onto the rest of its group', () => {
        const groups = [[row(2, 0, 'Matmul'), row(3, 1, 'Matmul')]];

        expect(getSiblingOpIds(groups, new Map([['3', 7]]))).toEqual(new Map([['2', 7]]));
    });

    it('never re-emits or overwrites the member that is already linked', () => {
        const groups = [[row(2, 0, 'Matmul'), row(3, 1, 'Matmul'), row(4, 2, 'Matmul')]];

        expect(getSiblingOpIds(groups, new Map([['3', 7]]))).toEqual(
            new Map([
                ['2', 7],
                ['4', 7],
            ]),
        );
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

    it('links every unmerged row to the op of the merged row in its group', () => {
        const opIdByPerfId = new Map(merged.map(({ id }, index) => [id, index]));
        const siblingOpIdByPerfId = getSiblingOpIds(groups, opIdByPerfId);

        for (const group of groups) {
            const mergedOpId = opIdByPerfId.get(group.find(({ id }) => mergedIds.has(id))!.id);

            for (const { id } of group) {
                expect(opIdByPerfId.get(id) ?? siblingOpIdByPerfId.get(id)).toBe(mergedOpId);
            }
        }

        expect(new Set(groups.flat().map(({ id }) => id))).toEqual(new Set(unmerged.map(({ id }) => id)));
    });
});
