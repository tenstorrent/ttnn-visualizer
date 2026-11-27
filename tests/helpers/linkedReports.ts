// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { vi } from 'vitest';
import {
    PerformanceReportResponse,
    useLinkedPerformanceReport,
    useOpToPerfIdFiltered,
    useOperationsList,
} from '../../src/hooks/useAPI';
import { OperationDescription } from '../../src/model/APIData';
import { PerfTableRow } from '../../src/model/PerfTable';

export type OpIdsMap = ReturnType<typeof useOpToPerfIdFiltered>;

/**
 * Stubs the memory report's operations and its link to the performance report. The calling
 * spec must `vi.mock('../src/hooks/useAPI')` with both hooks as `vi.fn()`: `vi.mock` is
 * hoisted per file, so it cannot live here.
 */
export const mockLinkedReports = (operations: OperationDescription[] | undefined, opIdsMap: OpIdsMap) => {
    vi.mocked(useOperationsList).mockReturnValue({ data: operations } as ReturnType<typeof useOperationsList>);
    vi.mocked(useOpToPerfIdFiltered).mockReturnValue(opIdsMap);
};

export const resetLinkedReportMocks = () => {
    vi.mocked(useOperationsList).mockReset();
    vi.mocked(useOpToPerfIdFiltered).mockReset();
};

/** Stubs the linked performance report (`undefined` rows: still loading); mock its hook as a `vi.fn()`, as above. */
export const mockLinkedPerformanceReport = (
    rows: PerfTableRow[] | undefined,
    envelope: Partial<PerformanceReportResponse> = {},
) =>
    vi
        .mocked(useLinkedPerformanceReport)
        .mockReturnValue({ data: rows && { report: rows, ...envelope } } as ReturnType<
            typeof useLinkedPerformanceReport
        >);
