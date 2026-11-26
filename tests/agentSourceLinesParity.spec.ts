// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { SourceLineGroupKind, SourceLineOperation, getSourceLineGroups } from '../src/functions/perfSourceLines';
import { PerfTableRow } from '../src/model/PerfTable';
import golden from './data/agentSourceLinesParity.json';

// The agent's Python port (#2364) wrote this golden, from test_agent_source_lines_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

// A group as the agent answers it. Basename and source file are app-only; function, which the
// agent answers as `call_site.function`, is not held either, since the golden holds file and line.
interface GroupAnswer {
    kind: SourceLineGroupKind;
    file: string | null;
    line: number | null;
    device_time: number;
    row_count: number;
    top_op_codes: string[];
    operation_ids: number[];
    // Absent where no row has countable device time: the agent answers null, the app 0%.
    share_percent?: number;
}

interface SourceLinesCase {
    rows: unknown[];
    opIdsMap: { perfId: string; opId: number }[];
    // Keyed by operation id; an operation absent here is missing from the operations list.
    stackTraces: Record<string, string | null>;
    groups: GroupAnswer[];
}

// The agent rounds a share to three significant figures, so it is within half a unit of the third.
const SHARE_RELATIVE_TOLERANCE = 5e-3;

const cases = (golden.cases as SourceLinesCase[]).map((entry, index) => [index, entry] as const);

it('the golden has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
});

describe('getSourceLineGroups', () => {
    it.each(cases)('case %i matches the agent', (_, { rows, opIdsMap, stackTraces, groups }) => {
        const operationById = new Map<number, SourceLineOperation>(
            Object.entries(stackTraces).map(([id, trace]) => [
                Number(id),
                // The API sends null for an operation with no trace, which `stack_trace`'s type
                // admits once #2368 lands.
                { stack_trace: trace as SourceLineOperation['stack_trace'], stack_trace_source_file_id: null },
            ]),
        );
        const typed = enrichRowData(rows as PerfTableRow[], opIdsMap, null);
        const actual = getSourceLineGroups(typed, operationById, { mergeDevices: true });

        expect(
            actual.map((group) => ({
                kind: group.kind,
                file: group.filePath,
                line: group.lineNumber,
                device_time: group.deviceTimeUs,
                row_count: group.rowCount,
                top_op_codes: group.topOpCodes,
                operation_ids: group.operationIds,
            })),
        ).toEqual(groups.map(({ share_percent: _share, ...group }) => group));

        groups.forEach(({ share_percent: share }, index) => {
            if (share !== undefined) {
                expect(Math.abs(actual[index].percent - share)).toBeLessThanOrEqual(share * SHARE_RELATIVE_TOLERANCE);
            }
        });

        // Shares are of every group's time, so a total that left a group out shows here at once.
        if (groups.every(({ share_percent: share }) => share !== undefined)) {
            expect(actual.reduce((sum, group) => sum + group.percent, 0)).toBeCloseTo(100, 9);
        }
    });
});
