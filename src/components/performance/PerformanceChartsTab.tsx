// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import PerfChartFilter from './PerfChartFilter';
import PerfCharts from './PerfCharts';
import PerfChartsIndex from './PerfChartsIndex';
import NonFilterablePerfCharts from './NonFilterablePerfCharts';
import { Marker } from '../../definitions/PerfTable';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { buildChartIndexEntries } from '../../functions/buildChartIndexEntries';
import { getPerfChartForChartId, recordPerfChartViewed } from '../../functions/surfaceEvents';
import { PerfChartLabel } from '../../definitions/EventLogEvent';
import { useActiveSection } from '../../hooks/useActiveSection';
import { usePrefilterPerfTableByOpCode } from '../../hooks/usePrefilterPerfTableByOpCode';
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
    const prefilterPerfTableByOpCode = usePrefilterPerfTableByOpCode();

    // Once per chart per mount, and this tab mounts only while it is the selected one, so a
    // count means the chart was in view on a visit to the Charts tab. The first chart counts
    // on arrival: it is what the tab opens on.
    const recordedChartsRef = useRef<Set<PerfChartLabel>>(new Set());

    useEffect(() => {
        const chart = activeId ? getPerfChartForChartId(activeId) : null;

        if (chart && !recordedChartsRef.current.has(chart)) {
            recordedChartsRef.current.add(chart);
            recordPerfChartViewed(chart);
        }
    }, [activeId]);

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
                        onOpCodeClick={prefilterPerfTableByOpCode}
                    />

                    <NonFilterablePerfCharts
                        chartData={enrichedData}
                        secondaryData={enrichedComparisonData || []}
                        opCodeOptions={opCodeOptions}
                        matmulData={matmulData}
                        convData={convData}
                        hasMatmulData={hasMatmulData}
                        hasConvData={hasConvData}
                        onOpCodeClick={prefilterPerfTableByOpCode}
                    />
                </div>
            </div>
        </div>
    );
};

export default PerformanceChartsTab;
