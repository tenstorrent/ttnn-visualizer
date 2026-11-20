// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OpType } from '../src/definitions/Performance';
import { getPathBasename } from '../src/functions/formatting';
import {
    SOURCE_LINE_NO_TRACE_LABEL,
    SOURCE_LINE_UNLINKED_LABEL,
    SourceLineGroupKind,
    SourceLineOperation,
    TOP_OP_CODE_COUNT,
    countSourceLines,
    getSourceLineGroups,
    isSourceLineGroupMatch,
} from '../src/functions/perfSourceLines';
import { TypedPerfTableRow } from '../src/model/PerfTable';

interface RowOptions {
    op?: number;
    deviceTime?: number | null;
    opCode?: string;
    device?: number | null;
    opType?: OpType;
}

const perfRow = ({
    op,
    deviceTime = 10,
    opCode = 'Matmul',
    device = 0,
    opType = OpType.DEVICE_OP,
}: RowOptions): TypedPerfTableRow =>
    ({
        op,
        device_time: deviceTime,
        raw_op_code: opCode,
        op_code: opCode,
        device,
        op_type: opType,
    }) as unknown as TypedPerfTableRow;

const trace = (file: string, line: number, fn = 'forward') =>
    `  File "${file}", line ${line}, in ${fn}\n    x = ttnn.op(a)\n\n  File "/m/runner.py", line 1, in run`;

const operations = (entries: [number, string, number?][]): Map<number, SourceLineOperation> =>
    new Map(
        entries.map(([id, stackTrace, sourceFileId]) => [
            id,
            { stack_trace: stackTrace, stack_trace_source_file_id: sourceFileId ?? null },
        ]),
    );

const MERGED = { mergeDevices: true };

describe('getSourceLineGroups', () => {
    it('merges the rows of operations called from the same line', () => {
        const groups = getSourceLineGroups(
            [perfRow({ op: 1, deviceTime: 10 }), perfRow({ op: 2, deviceTime: 30 })],
            operations([
                [1, trace('/m/model.py', 42), 7],
                [2, trace('/m/model.py', 42), 8],
            ]),
            MERGED,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            kind: SourceLineGroupKind.LINE,
            filePath: '/m/model.py',
            basename: 'model.py',
            lineNumber: 42,
            functionName: 'forward',
            deviceTimeUs: 40,
            rowCount: 2,
            operationIds: [1, 2],
            sourceFileId: 7,
            percent: 100,
        });
    });

    it('counts both rows of an operation with two rows but lists its id once', () => {
        const [group] = getSourceLineGroups(
            [perfRow({ op: 1 }), perfRow({ op: 1 })],
            operations([[1, trace('/m/model.py', 42)]]),
            MERGED,
        );

        expect(group.rowCount).toBe(2);
        expect(group.operationIds).toEqual([1]);
    });

    it('keeps unlinked rows and linked rows without a parseable trace in separate groups', () => {
        const groups = getSourceLineGroups(
            [perfRow({}), perfRow({ op: 1 }), perfRow({ op: 2 })],
            operations([[1, '#0 0x7f in ttnn::run()']]),
            MERGED,
        );

        expect(groups.map((group) => [group.kind, group.rowCount, group.operationIds])).toEqual(
            expect.arrayContaining([
                [SourceLineGroupKind.UNLINKED, 1, []],
                [SourceLineGroupKind.NO_TRACE, 2, [1, 2]],
            ]),
        );
        expect(groups).toHaveLength(2);
    });

    it('puts every linked row in the no-trace group while the operations list is empty', () => {
        const groups = getSourceLineGroups([perfRow({ op: 1 }), perfRow({ op: 2 })], new Map(), MERGED);

        expect(groups.map((group) => group.kind)).toEqual([SourceLineGroupKind.NO_TRACE]);
    });

    it('skips signposts', () => {
        const groups = getSourceLineGroups(
            [perfRow({ opType: OpType.SIGNPOST, deviceTime: null }), perfRow({ op: 1 })],
            operations([[1, trace('/m/model.py', 1)]]),
            MERGED,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].rowCount).toBe(1);
    });

    it('counts rows without countable device time but adds none of it', () => {
        const [group] = getSourceLineGroups(
            [
                perfRow({ op: 1, deviceTime: null }),
                perfRow({ op: 1, deviceTime: 0 }),
                perfRow({ op: 1, deviceTime: Number.NaN }),
                perfRow({ op: 1, deviceTime: 5 }),
            ],
            operations([[1, trace('/m/model.py', 1)]]),
            MERGED,
        );

        expect(group.rowCount).toBe(4);
        expect(group.deviceTimeUs).toBe(5);
    });

    it('gives percentages that sum to 100, sorted by device time', () => {
        const groups = getSourceLineGroups(
            [perfRow({ op: 1, deviceTime: 1 }), perfRow({ op: 2, deviceTime: 2 }), perfRow({ deviceTime: 3 })],
            operations([
                [1, trace('/m/a.py', 1)],
                [2, trace('/m/b.py', 2)],
            ]),
            MERGED,
        );

        expect(groups.map((group) => group.deviceTimeUs)).toEqual([3, 2, 1]);
        expect(groups.reduce((total, group) => total + group.percent, 0)).toBeCloseTo(100);
    });

    it('gives 0 rather than NaN when no time is countable', () => {
        const [group] = getSourceLineGroups(
            [perfRow({ op: 1, deviceTime: null })],
            operations([[1, trace('/m/a.py', 1)]]),
            MERGED,
        );

        expect(group.percent).toBe(0);
    });

    it('splits a line by device only while devices are unmerged', () => {
        const rows = [perfRow({ op: 1, device: 0 }), perfRow({ op: 1, device: 1 })];
        const operationById = operations([[1, trace('/m/a.py', 1)]]);

        const unmerged = getSourceLineGroups(rows, operationById, { mergeDevices: false });
        const merged = getSourceLineGroups(rows, operationById, MERGED);

        expect(unmerged.map((group) => group.device).sort()).toEqual([0, 1]);
        expect(merged).toHaveLength(1);
        expect(merged[0].device).toBeNull();
    });

    it("gives each unmerged line its share of its own device's time, as tt-perf-report does", () => {
        // Device 0 spends 30 µs, device 1 spends 10 µs; a.py takes 10 µs of each.
        const rows = [
            perfRow({ op: 1, device: 0, deviceTime: 10 }),
            perfRow({ op: 2, device: 0, deviceTime: 20 }),
            perfRow({ op: 1, device: 1, deviceTime: 10 }),
        ];
        const operationById = operations([
            [1, trace('/m/a.py', 1)],
            [2, trace('/m/b.py', 2)],
        ]);

        const percentByLine = Object.fromEntries(
            getSourceLineGroups(rows, operationById, { mergeDevices: false }).map((group) => [
                `${group.basename}@${group.device}`,
                group.percent,
            ]),
        );

        expect(percentByLine['a.py@0']).toBeCloseTo(100 / 3);
        expect(percentByLine['b.py@0']).toBeCloseTo(200 / 3);
        expect(percentByLine['a.py@1']).toBe(100);
    });

    it('keeps two files that share a basename apart', () => {
        const groups = getSourceLineGroups(
            [perfRow({ op: 1 }), perfRow({ op: 2 })],
            operations([
                [1, trace('/m/encoder/model.py', 10)],
                [2, trace('/m/decoder/model.py', 10)],
            ]),
            MERGED,
        );

        expect(groups.map((group) => group.filePath).sort()).toEqual(['/m/decoder/model.py', '/m/encoder/model.py']);
    });

    it('lists the top op codes by device time, capped', () => {
        const [group] = getSourceLineGroups(
            [
                perfRow({ op: 1, opCode: 'Add', deviceTime: 1 }),
                perfRow({ op: 1, opCode: 'Matmul', deviceTime: 5 }),
                perfRow({ op: 1, opCode: 'Softmax', deviceTime: 3 }),
                perfRow({ op: 1, opCode: 'Matmul', deviceTime: 5 }),
                perfRow({ op: 1, opCode: 'Reshape', deviceTime: 2 }),
            ],
            operations([[1, trace('/m/a.py', 1)]]),
            MERGED,
        );

        expect(group.topOpCodes).toEqual(['Matmul', 'Softmax', 'Reshape']);
        expect(group.topOpCodes).toHaveLength(TOP_OP_CODE_COUNT);
    });
});

describe('isSourceLineGroupMatch', () => {
    const [lineGroup] = getSourceLineGroups(
        [perfRow({ op: 1 })],
        operations([[1, trace('/m/models/resnet.py', 135, 'run_downsample_if_req')]]),
        MERGED,
    );
    const [unlinkedGroup] = getSourceLineGroups([perfRow({})], new Map(), MERGED);
    const [noTraceGroup] = getSourceLineGroups([perfRow({ op: 1 })], new Map(), MERGED);

    it.each([
        ['an empty query', ''],
        ['the directory', '/m/models'],
        ['the basename', 'RESNET.py'],
        ['the location', 'resnet.py:135'],
        ['the function', 'downsample'],
        ['a query with spaces around it', ' resnet.py:135 '],
    ])('matches a line on %s', (_, query) => {
        expect(isSourceLineGroupMatch(lineGroup, query)).toBe(true);
    });

    it('does not match an unrelated query', () => {
        expect(isSourceLineGroupMatch(lineGroup, 'matmul')).toBe(false);
    });

    it('matches the groups without a call site on their labels', () => {
        expect(isSourceLineGroupMatch(unlinkedGroup, SOURCE_LINE_UNLINKED_LABEL.slice(0, 9))).toBe(true);
        expect(isSourceLineGroupMatch(noTraceGroup, SOURCE_LINE_NO_TRACE_LABEL)).toBe(true);
        expect(isSourceLineGroupMatch(noTraceGroup, 'resnet')).toBe(false);
    });
});

describe('countSourceLines', () => {
    it('counts two files that share a basename and line as two lines', () => {
        const groups = getSourceLineGroups(
            [perfRow({ op: 1 }), perfRow({ op: 2 })],
            operations([
                [1, trace('/m/a/model.py', 3, 'f')],
                [2, trace('/m/b/model.py', 3, 'f')],
            ]),
            MERGED,
        );

        expect(countSourceLines(groups)).toBe(2);
    });

    it('counts a line once across unmerged devices, and no group without a call site', () => {
        const groups = getSourceLineGroups(
            [perfRow({ op: 1, device: 0 }), perfRow({ op: 1, device: 1 }), perfRow({}), perfRow({ op: 2 })],
            operations([[1, trace('/m/model.py', 3, 'f')]]),
            { mergeDevices: false },
        );

        expect(countSourceLines(groups)).toBe(1);
    });
});

describe('getPathBasename', () => {
    it.each([
        ['/m/models/resnet.py', 'resnet.py'],
        ['resnet.py', 'resnet.py'],
        ['C:\\models\\resnet.py', 'resnet.py'],
    ])('reads %s as %s', (path, basename) => {
        expect(getPathBasename(path)).toBe(basename);
    });
});
