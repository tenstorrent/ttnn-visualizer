// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { ReportLinkMatchResult } from '../definitions/ReportLinks';
import { isCountableDeviceTime } from '../functions/durationBuckets';
import { enrichRowData } from '../functions/enrichPerfRowData';
import memoiseLatest from '../functions/memoiseLatest';
import { DeviceOperationMapping } from '../model/DeviceOperationMapping';
import { PerfTableRow, TypedPerfTableRow } from '../model/PerfTable';
import { activePerformanceReportAtom } from '../store/app';
import { useGetDeviceOperationListPerfByOpId, useLinkedPerformanceReport } from './useAPI';
import { useReportLinkMatch } from './useReportLinkMatch';

export interface DeviceOperationPerf {
    linkStatus: ReportLinkMatchResult;
    /** Whether a performance report is selected: without one `UNAVAILABLE` means none is loaded, with one a failed read. */
    hasPerformanceReport: boolean;
    /** Keyed on the `function_start` node of each device operation's scope. */
    rowByStartNodeId: ReadonlyMap<number, TypedPerfTableRow>;
    /**
     * Every countable device time summed (µs), the denominator for a device operation's share.
     * Mirrored as `report_device_time_total` in `backend/ttnn_visualizer/agent/linking.py`.
     */
    totalDeviceTimeUs: number;
    hasHardwareCounters: boolean;
    // A merged row on a report of several devices is one device's, which its counters must name.
    isMultiDeviceReport: boolean;
}

const NO_ROWS: ReadonlyMap<number, TypedPerfTableRow> = new Map();
const NO_REPORT_ROWS: PerfTableRow[] = [];

// Once per report, not per mount: Operation Details and the operations list divide by it.
const sumDeviceTimeUs = memoiseLatest((rows: PerfTableRow[]): number =>
    rows.reduce((total, row) => {
        const deviceTime = parseFloat(row.device_time);

        return isCountableDeviceTime(deviceTime) ? total + deviceTime : total;
    }, 0),
);

/** The linked report's countable device time (µs), which every device operation's share divides by. */
export const useLinkedReportDeviceTimeTotalUs = (): number =>
    sumDeviceTimeUs(useLinkedPerformanceReport().data?.report ?? NO_REPORT_ROWS);

const hasPerfRow = (mapping: DeviceOperationMapping): mapping is DeviceOperationMapping & { perfData: PerfTableRow } =>
    mapping.perfData !== undefined;

/** @description One operation's device-operation perf rows, from the report linked to the memory report. */
export const useDeviceOperationPerf = (operationId: number): DeviceOperationPerf => {
    const linkStatus = useReportLinkMatch();
    const { data: perfReport } = useLinkedPerformanceReport();
    const mappings = useGetDeviceOperationListPerfByOpId().get(operationId);
    const hasPerformanceReport = useAtomValue(activePerformanceReportAtom) !== null;
    const totalDeviceTimeUs = useLinkedReportDeviceTimeTotalUs();

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

    const hasHardwareCounters = perfReport?.has_hardware_counters === true;
    const isMultiDeviceReport = (perfReport?.device_count ?? 0) > 1;

    return useMemo(
        () => ({
            linkStatus,
            hasPerformanceReport,
            rowByStartNodeId,
            totalDeviceTimeUs,
            hasHardwareCounters,
            isMultiDeviceReport,
        }),
        [
            linkStatus,
            hasPerformanceReport,
            rowByStartNodeId,
            totalDeviceTimeUs,
            hasHardwareCounters,
            isMultiDeviceReport,
        ],
    );
};
