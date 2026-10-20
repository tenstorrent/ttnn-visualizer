// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { vi } from 'vitest';
import { useOpToPerfIdFiltered, useOpToPerfIdForPerfTable, useOperationsList } from '../../src/hooks/useAPI';
import { OperationDescription } from '../../src/model/APIData';

export type OpIdsMap = ReturnType<typeof useOpToPerfIdFiltered>;

/**
 * Stubs the memory report's operations and its link to the performance report. The calling
 * spec must `vi.mock('../src/hooks/useAPI')` with all three hooks as `vi.fn()`: `vi.mock` is
 * hoisted per file, so it cannot live here. The table's lookup defaults to the merged one,
 * which is what it is while devices are merged.
 */
export const mockLinkedReports = (
    operations: OperationDescription[] | undefined,
    opIdsMap: OpIdsMap,
    perfTableOpIdsMap: OpIdsMap = opIdsMap,
) => {
    vi.mocked(useOperationsList).mockReturnValue({ data: operations } as ReturnType<typeof useOperationsList>);
    vi.mocked(useOpToPerfIdFiltered).mockReturnValue(opIdsMap);
    vi.mocked(useOpToPerfIdForPerfTable).mockReturnValue(perfTableOpIdsMap);
};

export const resetLinkedReportMocks = () => {
    vi.mocked(useOperationsList).mockReset();
    vi.mocked(useOpToPerfIdFiltered).mockReset();
    vi.mocked(useOpToPerfIdForPerfTable).mockReset();
};
