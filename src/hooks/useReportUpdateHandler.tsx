// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useQueryClient } from 'react-query';
import { useAtomValue } from 'jotai';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { BufferType } from '../model/BufferType';

interface ReportUpdateData {
    report_name: string;
    status: 'PASS' | 'FAIL' | 'ERROR';
    message_type: string;
    instance_id: string | null;
    timestamp: string;
}

/**
 * Custom hook to handle report update notifications and refresh relevant data
 */
export const useReportUpdateHandler = () => {
    const queryClient = useQueryClient();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const handleReportUpdate = useCallback(
        async (_data: ReportUpdateData) => {
            // Only refresh data if we have active reports
            if (activeProfilerReport) {
                // Invalidate memory report related queries
                await queryClient.invalidateQueries(['get-operations', activeProfilerReport]);
                await queryClient.invalidateQueries(['get-tensors', activeProfilerReport]);
                await queryClient.invalidateQueries(['get-devices', activeProfilerReport]);
                await queryClient.invalidateQueries(['get-cluster-description', activeProfilerReport]);

                // Invalidate buffer queries for all buffer types
                Object.values(BufferType).forEach(async (bufferType) => {
                    await queryClient.invalidateQueries(['fetch-all-buffers', bufferType, activeProfilerReport]);
                });
            }

            if (activePerformanceReport) {
                // Invalidate performance report related queries
                await queryClient.invalidateQueries(['get-performance-report', activePerformanceReport]);
                await queryClient.invalidateQueries(['get-device-log-raw', activePerformanceReport]);
            }
        },
        [queryClient, activeProfilerReport, activePerformanceReport],
    );

    return { handleReportUpdate };
};
