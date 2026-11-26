// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { comparisonPerformanceReportListAtom } from '../../src/store/app';

export const COMPARISON_LIST_PROBE_TEST_ID = 'comparison-list-probe';

/** Renders `comparisonPerformanceReportListAtom` so a spec can assert which folder ids it holds. */
export function ComparisonListProbe() {
    const comparisonReports = useAtomValue(comparisonPerformanceReportListAtom);

    return <span data-testid={COMPARISON_LIST_PROBE_TEST_ID}>{JSON.stringify(comparisonReports)}</span>;
}
