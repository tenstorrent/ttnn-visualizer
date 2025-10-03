// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { isStackedViewAtom } from '../../store/app';

export interface DataCounts {
    filtered: number;
    total: number;
    delta?: number;
}

interface PerfReportRowCountProps {
    standardView: DataCounts;
    stackedView: DataCounts;
    useNormalisedData: boolean;
}

const PerfReportRowCount = ({ standardView, stackedView, useNormalisedData }: PerfReportRowCountProps): string => {
    const isStackedView = useAtomValue(isStackedViewAtom);

    const currentView = isStackedView ? stackedView : standardView;
    const { filtered, total, delta = 0 } = currentView;

    return getRowCount(filtered, total, delta, useNormalisedData);
};

const getRowCount = (filteredCount: number, totalCount: number, delta: number, useNormalisedData: boolean): string => {
    const rowCountText =
        filteredCount !== totalCount ? `Showing ${filteredCount} of ${totalCount} rows` : `Showing ${totalCount} rows`;

    const rowDeltaText =
        useNormalisedData && delta ? ` (${delta > 0 ? `${delta} ops removed` : `${Math.abs(delta)} ops added`})` : null;

    return `${rowCountText}${rowDeltaText ?? ''}`;
};

export default PerfReportRowCount;
