// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum PerfChartId {
    OpDurationHistogram = 'perf-chart-op-duration-histogram',
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

export enum PerfChartGroup {
    ALL = 'all',
    MATMUL = 'matmul',
    CONV = 'conv',
}

/** Shared by the chart-index menu dividers and the on-page section headings so the two can't drift. */
export const PERF_CHART_GROUP_LABELS: Record<PerfChartGroup, string> = {
    [PerfChartGroup.ALL]: 'All operations',
    [PerfChartGroup.MATMUL]: 'Matmul operations',
    [PerfChartGroup.CONV]: 'Conv operations',
};

export const PERF_CHART_TABLE_FILTER_HINT = 'Click an operation to filter the performance table';

export type OnOpCodeClick = (opCode: string) => void;

/**
 * Shared second argument for chart-driven table prefilters. Callers report the gesture and what
 * they drew; the hook decides replace, toggle or clear, because only it can see the selection.
 */
export interface PerfTablePrefilterOptions<T extends string | number = string | number> {
    /** The user held shift: add or remove rather than replacing, and stay on the Charts tab. */
    additive?: boolean;
    /**
     * The values this caller renders a control for. A plain click on the only one of these that is
     * selected clears it. Without the scope the check runs against the whole cross-report filter,
     * which is populated from a wider row set than any single chart draws, so a control that is
     * visibly the sole selection can silently take the replace-and-navigate path instead.
     */
    visibleValues?: readonly T[];
}

export const PERF_CHART_LABELS: Record<PerfChartId, string> = {
    [PerfChartId.OpDurationHistogram]: 'Op Duration Distribution',
    [PerfChartId.OpCountVsRuntime]: 'Operation Count vs Device Time',
    [PerfChartId.CoreCountKernelRuntime]: 'Core Count + Device Kernel Runtime',
    [PerfChartId.KernelDurationVsCoreCount]: 'Device Kernel Duration vs Core Count',
    [PerfChartId.MatmulCoreCountUtilization]: 'Core Count + Utilization',
    [PerfChartId.MatmulDeviceTime]: 'Device Time + Ideal Time',
    [PerfChartId.MatmulKernelDurationUtilization]: 'Device Kernel Duration + Utilization',
    [PerfChartId.MatmulUtilizationVsKernelDuration]: 'Utilization vs Device Kernel Duration',
    [PerfChartId.ConvCoreCountUtilization]: 'Core Count + Utilization',
    [PerfChartId.ConvDeviceTime]: 'Device Time + Ideal Time',
    [PerfChartId.ConvKernelDurationUtilization]: 'Device Kernel Duration + Utilization',
    [PerfChartId.ConvUtilizationVsKernelDuration]: 'Utilization vs Device Kernel Duration',
    [PerfChartId.OperationTypes]: 'Operation Types',
};

export interface PerfChartIndexEntry {
    id: string;
    label: string;
    group: PerfChartGroup;
}

export const FILTERABLE_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.OpDurationHistogram,
        label: PERF_CHART_LABELS[PerfChartId.OpDurationHistogram],
        group: PerfChartGroup.ALL,
    },
    {
        id: PerfChartId.OpCountVsRuntime,
        label: PERF_CHART_LABELS[PerfChartId.OpCountVsRuntime],
        group: PerfChartGroup.ALL,
    },
    {
        id: PerfChartId.CoreCountKernelRuntime,
        label: PERF_CHART_LABELS[PerfChartId.CoreCountKernelRuntime],
        group: PerfChartGroup.ALL,
    },
    {
        id: PerfChartId.KernelDurationVsCoreCount,
        label: PERF_CHART_LABELS[PerfChartId.KernelDurationVsCoreCount],
        group: PerfChartGroup.ALL,
    },
];

export const MATMUL_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.MatmulCoreCountUtilization,
        label: PERF_CHART_LABELS[PerfChartId.MatmulCoreCountUtilization],
        group: PerfChartGroup.MATMUL,
    },
    {
        id: PerfChartId.MatmulDeviceTime,
        label: PERF_CHART_LABELS[PerfChartId.MatmulDeviceTime],
        group: PerfChartGroup.MATMUL,
    },
    {
        id: PerfChartId.MatmulKernelDurationUtilization,
        label: PERF_CHART_LABELS[PerfChartId.MatmulKernelDurationUtilization],
        group: PerfChartGroup.MATMUL,
    },
    {
        id: PerfChartId.MatmulUtilizationVsKernelDuration,
        label: PERF_CHART_LABELS[PerfChartId.MatmulUtilizationVsKernelDuration],
        group: PerfChartGroup.MATMUL,
    },
];

export const CONV_CHART_ENTRIES: PerfChartIndexEntry[] = [
    {
        id: PerfChartId.ConvCoreCountUtilization,
        label: PERF_CHART_LABELS[PerfChartId.ConvCoreCountUtilization],
        group: PerfChartGroup.CONV,
    },
    {
        id: PerfChartId.ConvDeviceTime,
        label: PERF_CHART_LABELS[PerfChartId.ConvDeviceTime],
        group: PerfChartGroup.CONV,
    },
    {
        id: PerfChartId.ConvKernelDurationUtilization,
        label: PERF_CHART_LABELS[PerfChartId.ConvKernelDurationUtilization],
        group: PerfChartGroup.CONV,
    },
    {
        id: PerfChartId.ConvUtilizationVsKernelDuration,
        label: PERF_CHART_LABELS[PerfChartId.ConvUtilizationVsKernelDuration],
        group: PerfChartGroup.CONV,
    },
];
