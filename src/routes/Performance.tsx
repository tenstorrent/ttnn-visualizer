// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { HttpStatusCode } from 'axios';
import {
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../hooks/useAPI';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportListAtom,
    perfSelectedTabAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerfCharts from '../components/performance/PerfCharts';
import PerfChartFilter from '../components/performance/PerfChartFilter';
import { Marker, MarkerColours, PerfTableRow, TypedPerfTableRow } from '../definitions/PerfTable';
import NonFilterablePerfCharts from '../components/performance/NonFilterablePerfCharts';
import ComparisonReportSelector from '../components/performance/ComparisonReportSelector';
import 'styles/routes/Performance.scss';
import getServerConfig from '../functions/getServerConfig';
import { OpType, PerfTabIds } from '../definitions/Performance';
import { BufferType } from '../model/BufferType';
import { DeviceOperationLayoutTypes } from '../model/APIData';

const INITIAL_TAB_ID = PerfTabIds.TABLE;

export default function Performance() {
    const [comparisonReportList, setComparisonReportList] = useAtom(comparisonPerformanceReportListAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedPerformanceRangeAtom);
    const [selectedTabId, setSelectedTabId] = useAtom(perfSelectedTabAtom);

    // const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    // const [filteredComparisonData, setFilteredComparisonData] = useState<PerfTableRow[][]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>([]);

    const {
        data,
        isLoading: isLoadingPerformance,
        error: perfDataError,
    } = usePerformanceReport(activePerformanceReport?.reportName || null);
    const { data: comparisonData } = usePerformanceComparisonReport();
    const { data: folderList } = usePerfFolderList();
    const perfRange = usePerformanceRange();
    const opIdsMap = useOpToPerfIdFiltered();

    const shouldDisableComparison = getServerConfig()?.SERVER_MODE;

    const perfData = data?.report;
    const stackedData = data?.stacked_report;
    const reportSelectors =
        comparisonReportList && comparisonReportList?.length > 0 ? [...comparisonReportList, null] : [null];
    const comparisonPerfData = useMemo(() => comparisonData?.map((d) => d.report) || [], [comparisonData]);
    const comparisonStackedData = useMemo(() => comparisonData?.map((d) => d.stacked_report) || [], [comparisonData]);
    const opCodeOptions = useMemo(() => {
        const opCodes = Array.from(
            new Set([
                ...(perfData
                    ?.filter((row) => row.op_type !== OpType.SIGNPOST)
                    .map((row) => row.raw_op_code)
                    .filter((opCode): opCode is string => opCode !== undefined) || []),
                ...(comparisonPerfData
                    ? comparisonPerfData.flatMap((report) =>
                          report
                              .filter((row) => row.op_type !== OpType.SIGNPOST)
                              .map((row) => row.raw_op_code)
                              .filter((opCode): opCode is string => opCode !== undefined),
                      )
                    : []),
            ]),
        );

        return opCodes.map((opCode, index) => ({
            opCode,
            colour: MarkerColours[index],
        }));
    }, [perfData, comparisonPerfData]);

    const rangedData = useMemo(
        () =>
            selectedRange && perfData
                ? perfData.filter((row) => {
                      const rowId = typeof row?.id === 'number' ? row.id : parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : [],
        [selectedRange, perfData],
    );

    const enrichedData = useMemo(() => enrichRowData(rangedData, opIdsMap), [rangedData, opIdsMap]);
    const enrichedComparisonData = useMemo(
        () => comparisonPerfData?.map((dataset) => enrichRowData(dataset, opIdsMap)) || [],
        [comparisonPerfData, opIdsMap],
    );

    // Clear comparison report if users switches active perf report to the comparison report
    useEffect(() => {
        if (activePerformanceReport && comparisonReportList?.includes(activePerformanceReport?.path)) {
            const filteredReports = comparisonReportList.filter((report) => report !== activePerformanceReport?.path);

            setComparisonReportList(filteredReports.length === 0 ? null : filteredReports);
        }
    }, [comparisonReportList, activePerformanceReport, setComparisonReportList]);

    // If a comparison report is selected, clear the selected range as we don't currently support ranges for comparison
    useEffect(() => {
        if (comparisonReportList && perfRange) {
            setSelectedRange([perfRange[0], perfRange[1]]);
        }
    }, [comparisonReportList, setSelectedRange, perfRange]);

    // useEffect(() => {
    //     setFilteredComparisonData(
    //         comparisonPerfData?.map((dataset) =>
    //             dataset.filter((row) =>
    //                 selectedOpCodes.length
    //                     ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '') ||
    //                       row.op_type === OpType.SIGNPOST
    //                     : row.op_type === OpType.SIGNPOST,
    //             ),
    //         ) || [],
    //     );
    // }, [selectedOpCodes, comparisonPerfData]);

    // useEffect(() => {
    //     setFilteredPerfData(
    //         perfData?.filter((row) =>
    //             selectedOpCodes.length
    //                 ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '') ||
    //                   row.op_type === OpType.SIGNPOST
    //                 : row.op_type === OpType.SIGNPOST,
    //         ) || [],
    //     );
    // }, [selectedOpCodes, perfData]);

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    if (isLoadingPerformance && !perfDataError) {
        return <LoadingSpinner />;
    }

    if (perfDataError?.status === HttpStatusCode.UnprocessableEntity) {
        return (
            <>
                <h2>Unable to process performance data</h2>
                <p>
                    Data format is not supported, try using{' '}
                    <a href='https://github.com/tenstorrent/ttnn-visualizer/releases/tag/v0.49.0'>
                        TT-NN Visualizer v0.49.0
                    </a>{' '}
                    or earlier, or regenerate performance report using a newer version of{' '}
                    <a href='https://github.com/tenstorrent/tt-metal/'>TT-Metal</a>.
                </p>
            </>
        );
    }

    return (
        <div className='performance data-padding'>
            <Helmet title='Performance' />

            <h1 className='page-title'>Performance analysis</h1>

            {!shouldDisableComparison &&
                (folderList ? (
                    <div className='comparison-selectors'>
                        {folderList &&
                            reportSelectors?.map((_, index) => (
                                <ComparisonReportSelector
                                    className='report-selector'
                                    key={`${index}-comparison-report-selector`}
                                    folderList={folderList}
                                    reportIndex={index}
                                    label={index === 0 ? <h2 className='label'>Compare</h2> : null}
                                    subLabel={index === 0 ? 'Select from performance reports to compare' : ''}
                                />
                            ))}
                    </div>
                ) : (
                    <LoadingSpinner />
                ))}

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                renderActiveTabPanelOnly
                size={Size.LARGE}
            >
                <Tab
                    id={INITIAL_TAB_ID}
                    title='Table'
                    icon={IconNames.TH}
                    panel={
                        <PerformanceReport
                            data={enrichedData}
                            comparisonData={enrichedComparisonData}
                            stackedData={stackedData}
                            comparisonStackedData={comparisonStackedData}
                            signposts={data?.signposts}
                            rawComparisonData={comparisonPerfData}
                        />
                    }
                />

                <Tab
                    id={PerfTabIds.CHARTS}
                    title='Charts'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='chart-tab'>
                            <h3 className='title'>Performance charts</h3>

                            {perfData ? (
                                <>
                                    <div className='charts-container'>
                                        <PerfChartFilter
                                            opCodeOptions={opCodeOptions}
                                            selectedOpCodes={selectedOpCodes}
                                            updateOpCodes={setSelectedOpCodes}
                                        />

                                        <PerfCharts
                                            filteredPerfData={enrichedData}
                                            comparisonData={enrichedComparisonData || []}
                                            selectedOpCodes={selectedOpCodes}
                                        />
                                    </div>

                                    <div className='charts-container non-filterable-charts'>
                                        <span />

                                        <div>
                                            <NonFilterablePerfCharts
                                                chartData={enrichedData}
                                                secondaryData={enrichedComparisonData || []}
                                                opCodeOptions={opCodeOptions}
                                            />
                                        </div>
                                    </div>
                                </>
                            ) : null}
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}

const HIGH_DISPATCH_THRESHOLD = 6.5;

interface RowAttributes {
    device: number | null;
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

const getBufferType = (type?: string): BufferType | null => {
    if (!type) {
        return null;
    }

    if (type === 'L1') {
        return BufferType.L1;
    }

    if (type === 'DRAM') {
        return BufferType.DRAM;
    }

    return null;
};

const getRowAttributes = (row: PerfTableRow): RowAttributes => {
    const regex = /DEV_(\d)_(DRAM|L1)_(\w*)/m;
    const matchIn0 = regex.exec(row.input_0_memory);

    return {
        device: matchIn0?.[1] ? parseInt(matchIn0[1], 10) : null,
        buffer_type: getBufferType(matchIn0?.[2]),
        layout: matchIn0?.[3] ? (matchIn0[3] as DeviceOperationLayoutTypes) : null,
    };
};

const enrichRowData = (rows: PerfTableRow[], opIdsMap: { perfId?: string; opId: number }[]): TypedPerfTableRow[] => {
    return rows.map((row) => {
        const val = parseInt(row.op_to_op_gap, 10);
        const opStr = opIdsMap.find((opMap) => opMap.perfId === row.id)?.opId;
        const op = opStr !== undefined ? Number(opStr) : undefined;

        return {
            ...row,
            op,
            high_dispatch: !!val && val > HIGH_DISPATCH_THRESHOLD,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
            pm_ideal_ns: row.pm_ideal_ns ? parseFloat(row.pm_ideal_ns) : null,
            ...getRowAttributes(row),
        };
    });
};
