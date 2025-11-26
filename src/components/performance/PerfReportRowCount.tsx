// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { filterBySignpostAtom, isStackedViewAtom } from '../../store/app';

interface PerfReportRowCountProps {
    filteredCount: number;
    total: number;
    delta: number;
    useNormalisedData: boolean;
    // hasSignpostFilter?: boolean;
}

const PerfReportRowCount = ({
    filteredCount,
    total,
    delta,
    useNormalisedData,
    // hasSignpostFilter,
}: PerfReportRowCountProps): string => {
    const isStackedView = useAtomValue(isStackedViewAtom);
    const hasSignpostFilter = useAtomValue(filterBySignpostAtom);

    // Signpost filter adds an extra row for the initial signpost, but only in standard view
    const computedTotal = hasSignpostFilter && !isStackedView ? total + 1 : total;

    return getRowCount(filteredCount, computedTotal, delta, useNormalisedData);
};

const getRowCount = (filteredCount: number, totalCount: number, delta: number, useNormalisedData: boolean): string => {
    const rowCountText =
        filteredCount !== totalCount ? `Showing ${filteredCount} of ${totalCount} rows` : `Showing ${totalCount} rows`;

    const rowDeltaText =
        useNormalisedData && delta ? ` (${delta > 0 ? `${delta} ops added` : `${Math.abs(delta)} ops removed`})` : null;

    return `${rowCountText}${rowDeltaText ?? ''}`;
};

export default PerfReportRowCount;
