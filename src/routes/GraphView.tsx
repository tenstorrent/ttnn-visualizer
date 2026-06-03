// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router';

import { useAtomValue } from 'jotai';
import { useOperationsList, usePerformanceReport } from '../hooks/useAPI';
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

    useClearSelectedBuffer();

    const filteredOperationList = useMemo(
        () =>
            selectedOperationRange
                ? operationList?.filter((op) => selectedOperationRange[0] && op.id <= selectedOperationRange[1])
                : operationList,
        [operationList, selectedOperationRange],
    );

    // Project raw perf rows down to just the fields the overlay needs.
    // Avoids pulling the full Performance-route enrichment pipeline (TypedPerfTableRow
    // construction) into the graph route.
    const perfOverlayRows = useMemo<PerfOverlaySource[] | undefined>(() => {
        const raw = perfReport?.report;
        if (!raw || raw.length === 0) {
            return undefined;
        }
        return raw.map((row) => {
            const parsedId = parseInt(row.id, 10);
            const parsedDeviceTime = parseFloat(row.device_time);
            return {
                id: Number.isFinite(parsedId) ? parsedId : null,
                device_time: Number.isFinite(parsedDeviceTime) ? parsedDeviceTime : null,
            };
        });
    }, [perfReport]);

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
                />
            )}
        </div>
    );
};

export default GraphView;
