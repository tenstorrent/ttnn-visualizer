// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    CONV_CHART_ENTRIES,
    FILTERABLE_CHART_ENTRIES,
    MATMUL_CHART_ENTRIES,
    PERF_CHART_LABELS,
    PerfChartId,
    type PerfChartIndexEntry,
} from '../definitions/PerformanceCharts';

export function getOperationTypesChartId(key: 'active' | `comparison-${number}`): string {
    return `${PerfChartId.OperationTypes}-${key}`;
}

export function getOperationTypesChartLabel(reportTitle: string): string {
    return reportTitle
        ? `${PERF_CHART_LABELS[PerfChartId.OperationTypes]} — ${reportTitle}`
        : PERF_CHART_LABELS[PerfChartId.OperationTypes];
}

export function getOperationTypesEntryLabel(reportName: string, hasComparison: boolean): string {
    return getOperationTypesChartLabel(hasComparison ? reportName : '');
}

interface ChartIndexParams {
    hasMatmulData: boolean;
    hasConvData: boolean;
    activeReportName: string | null;
    comparisonReportNames: string[] | null;
}

/**
 * Assembles the ordered list of chart-index entries shown in the "jump to chart" menu, matching the
 * order charts render on the page: filterable charts, then matmul/conv groups (only when present),
 * then one Operation Types entry per visible report. Operation Types labels carry the report name
 * only while a comparison is active, mirroring the chart headings.
 */
export function buildChartIndexEntries({
    hasMatmulData,
    hasConvData,
    activeReportName,
    comparisonReportNames,
}: ChartIndexParams): PerfChartIndexEntry[] {
    const entries: PerfChartIndexEntry[] = [...FILTERABLE_CHART_ENTRIES];

    if (hasMatmulData) {
        entries.push(...MATMUL_CHART_ENTRIES);
    }

    if (hasConvData) {
        entries.push(...CONV_CHART_ENTRIES);
    }

    const hasComparison = Boolean(comparisonReportNames);

    if (activeReportName !== null) {
        entries.push({
            id: getOperationTypesChartId('active'),
            label: getOperationTypesEntryLabel(activeReportName, hasComparison),
        });
    }

    comparisonReportNames?.forEach((report, index) => {
        entries.push({
            id: getOperationTypesChartId(`comparison-${index}`),
            label: getOperationTypesEntryLabel(report, activeReportName !== null),
        });
    });

    return entries;
}
