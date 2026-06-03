// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router';

import { useAtomValue } from 'jotai';
import { useGetDeviceOperationListPerf, useOperationsList, usePerformanceReport } from '../hooks/useAPI';
import OperationGraph from '../components/OperationGraphComponent';
import LoadingSpinner from '../components/LoadingSpinner';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import { activePerformanceReportAtom, selectedOperationRangeAtom } from '../store/app';
import { PerfOverlaySource } from '../functions/perfOverlay';

const GraphView = () => {
    const { data: operationList, isLoading } = useOperationsList();
    const { operationId } = useParams<{ operationId?: string }>();
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const { data: perfReport } = usePerformanceReport(activePerformanceReport?.reportName ?? null);
    // Canonical "do the loaded reports belong to the same run?" signal. This is
    // the same name-based lock-step match used by `ReportLinkStatus`: returns
    // `[]` whenever the loaded perf report doesn't line up with the profiler
    // report, which the overlay must treat as UNLINKED rather than READY.
    const matchedPerfOps = useGetDeviceOperationListPerf();

    useClearSelectedBuffer();

    const filteredOperationList = useMemo(
        () =>
            selectedOperationRange
                ? operationList?.filter((op) => selectedOperationRange[0] && op.id <= selectedOperationRange[1])
                : operationList,
        [operationList, selectedOperationRange],
    );

    // Source overlay rows from the matched op list so the row `id` is the
    // *profiler* op id (what the graph keys on), not the perf-table row index.
    // The two id spaces often coincide for simple non-tracing runs, which is
    // why the previous "rows from perfReport.report directly" approach passed
    // most of the time and then silently mis-matched on mixed-run reports.
    const perfOverlayRows = useMemo<PerfOverlaySource[] | undefined>(() => {
        if (matchedPerfOps.length === 0) {
            return undefined;
        }
        return matchedPerfOps.flatMap((op) => {
            const deviceTime = op.perfData?.device_time;
            if (deviceTime === undefined) {
                return [];
            }
            const parsedDeviceTime = parseFloat(deviceTime);
            return [
                {
                    id: op.id,
                    device_time: Number.isFinite(parsedDeviceTime) ? parsedDeviceTime : null,
                },
            ];
        });
    }, [matchedPerfOps]);

    // The component needs to distinguish "no perf report loaded at all"
    // (UNAVAILABLE) from "loaded but doesn't match this graph" (UNLINKED).
    // `perfOverlayRows` collapses both into "empty"; this flag preserves the
    // distinction so the tooltip can say the right thing.
    const isPerfReportLoaded = Boolean(perfReport?.report?.length);

    return (
        <div className='data-padding'>
            <Helmet title='GraphTree' />

            {isLoading || filteredOperationList === undefined || filteredOperationList.length === 0 ? (
                <div className='graph-tree-loader'>
                    <LoadingSpinner />
                </div>
            ) : (
                <OperationGraph
                    operationList={filteredOperationList}
                    operationId={operationId ? parseInt(operationId, 10) : undefined}
                    perfRows={perfOverlayRows}
                    isPerfReportLoaded={isPerfReportLoaded}
                />
            )}
        </div>
    );
};

export default GraphView;
