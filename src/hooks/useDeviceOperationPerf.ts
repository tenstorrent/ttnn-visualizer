// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { PerfOverlayStatus } from '../definitions/PerfOverlayStatus';
import { enrichRowData } from '../functions/enrichPerfRowData';
import { DeviceOperationMapping } from '../model/DeviceOperationMapping';
import { PerfTableRow, TypedPerfTableRow } from '../model/PerfTable';
import { activePerformanceReportFolderNameAtom } from '../store/app';
import { useGetDeviceOperationListPerfByOpId, useLinkedPerformanceReport } from './useAPI';

export interface DeviceOperationPerf {
    status: PerfOverlayStatus;
    isLoading: boolean;
    /** Keyed on the `function_start` node of each device operation's scope. */
    rowByStartNodeId: ReadonlyMap<number, TypedPerfTableRow>;
    /** Every row's device time summed (µs), the denominator for a device operation's share. */
    totalDeviceTimeUs: number;
}

const NO_ROWS: ReadonlyMap<number, TypedPerfTableRow> = new Map();

const sumDeviceTimeUs = (rows: PerfTableRow[]): number =>
    rows.reduce((total, row) => {
        const deviceTime = parseFloat(row.device_time);

        return Number.isFinite(deviceTime) ? total + deviceTime : total;
    }, 0);

type AttributedMapping = DeviceOperationMapping & { perfData: PerfTableRow; startNodeId: number };

const isAttributed = (mapping: DeviceOperationMapping): mapping is AttributedMapping =>
    mapping.perfData !== undefined && mapping.startNodeId !== undefined;

/** @description One operation's device-operation perf rows, from the report linked to the memory report. */
export const useDeviceOperationPerf = (operationId: number): DeviceOperationPerf => {
    const activeReportFolderName = useAtomValue(activePerformanceReportFolderNameAtom);
    const { data: perfReport } = useLinkedPerformanceReport();
    const matchedByOpId = useGetDeviceOperationListPerfByOpId();
    const mappings = matchedByOpId.get(operationId);
    const isLinked = matchedByOpId.size > 0;
    const totalDeviceTimeUs = useMemo(() => sumDeviceTimeUs(perfReport?.report ?? []), [perfReport]);

    return useMemo(() => {
        const empty = { rowByStartNodeId: NO_ROWS, totalDeviceTimeUs };

        if (activeReportFolderName === null) {
            return { ...empty, status: PerfOverlayStatus.UNAVAILABLE, isLoading: false };
        }

        if (perfReport === undefined) {
            return { ...empty, status: PerfOverlayStatus.UNAVAILABLE, isLoading: true };
        }

        if (!isLinked) {
            return { ...empty, status: PerfOverlayStatus.UNLINKED, isLoading: false };
        }

        const attributed = (mappings ?? []).filter(isAttributed);
        const typedRows = enrichRowData(
            attributed.map(({ perfData }) => perfData),
            attributed.map(({ id, perfData }) => ({ perfId: perfData.id, opId: id })),
            null,
        );

        return {
            status: PerfOverlayStatus.READY,
            isLoading: false,
            rowByStartNodeId: new Map(attributed.map(({ startNodeId }, index) => [startNodeId, typedRows[index]])),
            totalDeviceTimeUs,
        };
    }, [activeReportFolderName, perfReport, isLinked, mappings, totalDeviceTimeUs]);
};
