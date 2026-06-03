// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import PerfChartFilter from './PerfChartFilter';
import PerfCharts from './PerfCharts';
import PerfChartsIndex from './PerfChartsIndex';
import NonFilterablePerfCharts from './NonFilterablePerfCharts';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { buildChartIndexEntries } from '../../definitions/PerformanceCharts';
import { useActiveSection } from '../../hooks/useActiveSection';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import 'styles/components/PerfCharts.scss';

interface PerformanceChartsTabProps {
    filteredPerfData: TypedPerfTableRow[];
    filteredComparisonData?: TypedPerfTableRow[][];
    enrichedData: TypedPerfTableRow[];
    enrichedComparisonData?: TypedPerfTableRow[][];
    selectedOpCodes: Marker[];
    opCodeOptions: Marker[];
    updateOpCodes: (opCodes: Marker[]) => void;
}

export const PERF_CHARTS_NAV_OFFSET_PX = 60;

const PerformanceChartsTab = ({
    filteredPerfData,
    filteredComparisonData,
    enrichedData,
    enrichedComparisonData,
    selectedOpCodes,
    opCodeOptions,
    updateOpCodes,
}: PerformanceChartsTabProps) => {
    const performanceReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const datasets = useMemo(
        () => [enrichedData, ...(enrichedComparisonData || [])].filter((set) => set.length > 0),
        [enrichedData, enrichedComparisonData],
    );

    const matmulData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('matmul'))),
        [datasets],
    );

    const convData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('conv'))),
        [datasets],
    );

    const hasMatmulData = matmulData.some((set) => set.length > 0);
    const hasConvData = convData.some((set) => set.length > 0);

    const chartIndexEntries = useMemo(
        () =>
            buildChartIndexEntries({
                hasMatmulData,
                hasConvData,
                activeReportName: performanceReport?.reportName ?? null,
                comparisonReportNames: comparisonReportList,
            }),
        [comparisonReportList, hasConvData, hasMatmulData, performanceReport],
    );

    const chartIndexIds = useMemo(() => chartIndexEntries.map((entry) => entry.id), [chartIndexEntries]);
    const activeId = useActiveSection(chartIndexIds, PERF_CHARTS_NAV_OFFSET_PX);

    return (
        <div className='charts-container'>
            <aside className='charts-sidebar'>
                <PerfChartFilter
                    opCodeOptions={opCodeOptions}
                    selectedOpCodes={selectedOpCodes}
                    updateOpCodes={updateOpCodes}
                />
            </aside>

            <div className='charts-column'>
                <PerfChartsIndex
                    entries={chartIndexEntries}
                    activeId={activeId}
                />

                <div className='charts'>
                    <PerfCharts
                        filteredPerfData={filteredPerfData}
                        comparisonData={filteredComparisonData}
                        selectedOpCodes={selectedOpCodes}
                    />

                    <NonFilterablePerfCharts
                        chartData={enrichedData}
                        secondaryData={enrichedComparisonData || []}
                        opCodeOptions={opCodeOptions}
                        matmulData={matmulData}
                        convData={convData}
                        hasMatmulData={hasMatmulData}
                        hasConvData={hasConvData}
                    />
                </div>
            </div>
        </div>
    );
};

export default PerformanceChartsTab;
