// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum PerfChartId {
    OpCountVsRuntime = 'perf-chart-op-count-vs-runtime',
    CoreCountKernelRuntime = 'perf-chart-core-count-kernel-runtime',
    KernelDurationVsCoreCount = 'perf-chart-kernel-duration-vs-core-count',
    MatmulCoreCountUtilization = 'perf-chart-matmul-core-count-utilization',
    MatmulDeviceTime = 'perf-chart-matmul-device-time',
    MatmulKernelDurationUtilization = 'perf-chart-matmul-kernel-duration-utilization',
    MatmulUtilizationVsKernelDuration = 'perf-chart-matmul-utilization-vs-kernel-duration',
    ConvCoreCountUtilization = 'perf-chart-conv-core-count-utilization',
    ConvDeviceTime = 'perf-chart-conv-device-time',
    ConvKernelDurationUtilization = 'perf-chart-conv-kernel-duration-utilization',
    ConvUtilizationVsKernelDuration = 'perf-chart-conv-utilization-vs-kernel-duration',
    OperationTypes = 'perf-chart-operation-types',
}

export const PERF_CHART_LABELS: Record<PerfChartId, string> = {
    [PerfChartId.OpCountVsRuntime]: 'Operation Count vs Device Time',
    [PerfChartId.CoreCountKernelRuntime]: 'Core Count + Device Kernel Runtime',
    [PerfChartId.KernelDurationVsCoreCount]: 'Device Kernel Duration vs Core Count',
    [PerfChartId.MatmulCoreCountUtilization]: 'Matmul · Core Count + Utilization',
    [PerfChartId.MatmulDeviceTime]: 'Matmul · Device Time + Ideal Time',
    [PerfChartId.MatmulKernelDurationUtilization]: 'Matmul · Device Kernel Duration + Utilization',
    [PerfChartId.MatmulUtilizationVsKernelDuration]: 'Matmul · Utilization vs Device Kernel Duration',
    [PerfChartId.ConvCoreCountUtilization]: 'Conv · Core Count + Utilization',
    [PerfChartId.ConvDeviceTime]: 'Conv · Device Time + Ideal Time',
    [PerfChartId.ConvKernelDurationUtilization]: 'Conv · Device Kernel Duration + Utilization',
    [PerfChartId.ConvUtilizationVsKernelDuration]: 'Conv · Utilization vs Device Kernel Duration',
    [PerfChartId.OperationTypes]: 'Operation Types',
};

export function getOperationTypesChartId(key: 'active' | `comparison-${number}`): string {
    return `${PerfChartId.OperationTypes}-${key}`;
}

export function getOperationTypesChartLabel(reportTitle: string): string {
    return reportTitle
        ? `${PERF_CHART_LABELS[PerfChartId.OperationTypes]} — ${reportTitle}`
        : PERF_CHART_LABELS[PerfChartId.OperationTypes];
}

export interface PerfChartIndexEntry {
    id: string;
    label: string;
}

export const FILTERABLE_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.OpCountVsRuntime,
        label: PERF_CHART_LABELS[PerfChartId.OpCountVsRuntime],
    },
    {
        id: PerfChartId.CoreCountKernelRuntime,
        label: PERF_CHART_LABELS[PerfChartId.CoreCountKernelRuntime],
    },
    {
        id: PerfChartId.KernelDurationVsCoreCount,
        label: PERF_CHART_LABELS[PerfChartId.KernelDurationVsCoreCount],
    },
];

export const MATMUL_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.MatmulCoreCountUtilization,
        label: PERF_CHART_LABELS[PerfChartId.MatmulCoreCountUtilization],
    },
    {
        id: PerfChartId.MatmulDeviceTime,
        label: PERF_CHART_LABELS[PerfChartId.MatmulDeviceTime],
    },
    {
        id: PerfChartId.MatmulKernelDurationUtilization,
        label: PERF_CHART_LABELS[PerfChartId.MatmulKernelDurationUtilization],
    },
    {
        id: PerfChartId.MatmulUtilizationVsKernelDuration,
        label: PERF_CHART_LABELS[PerfChartId.MatmulUtilizationVsKernelDuration],
    },
];

export const CONV_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.ConvCoreCountUtilization,
        label: PERF_CHART_LABELS[PerfChartId.ConvCoreCountUtilization],
    },
    {
        id: PerfChartId.ConvDeviceTime,
        label: PERF_CHART_LABELS[PerfChartId.ConvDeviceTime],
    },
    {
        id: PerfChartId.ConvKernelDurationUtilization,
        label: PERF_CHART_LABELS[PerfChartId.ConvKernelDurationUtilization],
    },
    {
        id: PerfChartId.ConvUtilizationVsKernelDuration,
        label: PERF_CHART_LABELS[PerfChartId.ConvUtilizationVsKernelDuration],
    },
];
