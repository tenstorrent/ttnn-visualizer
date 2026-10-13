// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { ReportLinkMatchResult } from '../definitions/ReportLinks';
import { isCountableDeviceTime } from '../functions/durationBuckets';
import { enrichRowData } from '../functions/enrichPerfRowData';
import { DeviceOperationMapping } from '../model/DeviceOperationMapping';
import { PerfTableRow, TypedPerfTableRow } from '../model/PerfTable';
import { useGetDeviceOperationListPerfByOpId, useLinkedPerformanceReport } from './useAPI';
import { useReportLinkMatch } from './useReportLinkMatch';

export interface DeviceOperationPerf {
    linkStatus: ReportLinkMatchResult;
    /** Keyed on the `function_start` node of each device operation's scope. */
    rowByStartNodeId: ReadonlyMap<number, TypedPerfTableRow>;
    /**
     * Every countable device time summed (µs), the denominator for a device operation's share.
     * Mirrored as `report_device_time_total` in `backend/ttnn_visualizer/agent/linking.py`.
     */
    totalDeviceTimeUs: number;
}

const NO_ROWS: ReadonlyMap<number, TypedPerfTableRow> = new Map();

const sumDeviceTimeUs = (rows: PerfTableRow[]): number =>
    rows.reduce((total, row) => {
        const deviceTime = parseFloat(row.device_time);

        return isCountableDeviceTime(deviceTime) ? total + deviceTime : total;
    }, 0);

const hasPerfRow = (mapping: DeviceOperationMapping): mapping is DeviceOperationMapping & { perfData: PerfTableRow } =>
    mapping.perfData !== undefined;

/** @description One operation's device-operation perf rows, from the report linked to the memory report. */
export const useDeviceOperationPerf = (operationId: number): DeviceOperationPerf => {
    const linkStatus = useReportLinkMatch();
    const { data: perfReport } = useLinkedPerformanceReport();
    const mappings = useGetDeviceOperationListPerfByOpId().get(operationId);
    const totalDeviceTimeUs = useMemo(() => sumDeviceTimeUs(perfReport?.report ?? []), [perfReport]);

    const rowByStartNodeId = useMemo(() => {
        if (linkStatus !== ReportLinkMatchResult.LINKED) {
            return NO_ROWS;
        }

        const matched = (mappings ?? []).filter(hasPerfRow);
        const typedRows = enrichRowData(
            matched.map(({ perfData }) => perfData),
            matched.map(({ id, perfData }) => ({ perfId: perfData.id, opId: id })),
            null,
        );

        return new Map(matched.map(({ startNodeId }, index) => [startNodeId, typedRows[index]]));
    }, [linkStatus, mappings]);

    return useMemo(
        () => ({ linkStatus, rowByStartNodeId, totalDeviceTimeUs }),
        [linkStatus, rowByStartNodeId, totalDeviceTimeUs],
    );
};
